// The page half of the dev bridge (see devbridge.rs). Injected into every
// document of a build that has the `devbridge` feature; a release build does
// not contain it.
(function () {
  if (window.__emeraldBridge) return;

  // Evaluation results that are not plain data stay here until the client
  // asks for them by id, the way a DevTools object handle works.
  var objects = {};
  var nextObject = 1;
  var started = {};
  var hovered = null;
  // Set while a script from the bridge is being tried as an expression: one
  // that turns out to be statements fails to parse, and that is no error of
  // the app's.
  var probing = false;

  function invoke(command, args) {
    try {
      var sent = window.__TAURI_INTERNALS__.invoke(command, args);
      if (sent && sent.catch) sent.catch(function () {});
    } catch (e) {
      // No IPC yet, or none any more: there is nobody to tell.
    }
  }

  function emit(method, params) {
    invoke('devbridge_event', { payload: JSON.stringify({ method: method, params: params }) });
  }

  function errorText(e) {
    if (e && typeof e === 'object' && 'message' in e) return (e.name || 'Error') + ': ' + e.message;
    return String(e);
  }

  // ── Console ────────────────────────────────────────────────────────────

  var CONSOLE_ARG_MAX = 2000;

  function consoleArg(value) {
    if (typeof value === 'string') return { type: 'string', value: value };
    if (value === undefined) return { type: 'undefined' };
    if (value instanceof Error) return { type: 'string', value: errorText(value) };
    if (typeof value === 'function') return { type: 'function', description: 'function ' + (value.name || '') };
    try {
      var text = JSON.stringify(value);
      if (text === undefined) return { type: typeof value, description: String(value) };
      if (text.length > CONSOLE_ARG_MAX) return { type: 'string', value: text.slice(0, CONSOLE_ARG_MAX) + '…' };
      return { type: typeof value, value: JSON.parse(text) };
    } catch (e) {
      return { type: typeof value, description: Object.prototype.toString.call(value) };
    }
  }

  var levels = { log: 'log', info: 'info', warn: 'warning', error: 'error', debug: 'debug' };
  Object.keys(levels).forEach(function (name) {
    var original = console[name];
    console[name] = function () {
      try {
        emit('Runtime.consoleAPICalled', { type: levels[name], args: Array.prototype.map.call(arguments, consoleArg) });
      } catch (e) {
        // Reporting must never break the call it reports.
      }
      return original.apply(console, arguments);
    };
  });

  window.addEventListener('error', function (e) {
    if (probing && /SyntaxError/.test(String(e.message))) return;
    emit('Runtime.exceptionThrown', {
      exceptionDetails: {
        text: 'Uncaught',
        url: e.filename || undefined,
        lineNumber: (e.lineno || 1) - 1,
        exception: { description: e.error ? errorText(e.error) : String(e.message) },
      },
    });
  });
  window.addEventListener('unhandledrejection', function (e) {
    emit('Runtime.exceptionThrown', {
      exceptionDetails: { text: 'Uncaught (in promise)', exception: { description: errorText(e.reason) } },
    });
  });

  // ── Dialogs ────────────────────────────────────────────────────────────
  //
  // A native file dialog cannot be answered from outside on macOS, and not
  // read at all on Linux. So the calls that would open one are held here
  // instead: the app waits for its answer exactly as it would for the dialog,
  // and the client lists and answers what is waiting. Only dialogs asked for
  // from the page pass through here; one the Rust side opens is native.

  var dialogs = [];

  function messageButtons(command, args) {
    if (command === 'ask') return [args.yesButtonLabel || 'Yes', args.noButtonLabel || 'No'];
    if (command === 'confirm') return [args.okButtonLabel || 'Ok', args.cancelButtonLabel || 'Cancel'];
    var buttons = args.buttons;
    if (buttons === 'OkCancel') return ['Ok', 'Cancel'];
    if (buttons === 'YesNo') return ['Yes', 'No'];
    if (buttons === 'YesNoCancel') return ['Yes', 'No', 'Cancel'];
    if (buttons && typeof buttons === 'object') {
      var custom = buttons.OkCustom || buttons.OkCancelCustom || buttons.YesNoCancelCustom;
      return typeof custom === 'string' ? [custom] : custom;
    }
    return [args.okButtonLabel || 'Ok'];
  }

  function heldDialog(command, args) {
    var name = /^plugin:dialog\|(open|save|message|ask|confirm)$/.exec(command);
    if (!name) return null;
    name = name[1];
    if (name === 'open' || name === 'save') {
      var options = args.options || {};
      var text = [];
      if (options.defaultPath) text.push('default: ' + options.defaultPath);
      (options.filters || []).forEach(function (filter) {
        text.push(filter.name + ': ' + (filter.extensions || []).join(', '));
      });
      var accept = name === 'save' ? 'Save' : 'Open';
      return {
        file: name === 'save' ? 'save' : options.directory ? 'folder' : 'open',
        many: !!options.multiple,
        fallback: options.defaultPath,
        title: options.title || (name === 'save' ? 'Save' : options.directory ? 'Select Folder' : 'Open'),
        text: text.join('\n'),
        buttons: [accept, 'Cancel'],
      };
    }
    return { answers: name, title: args.title || '', text: args.message || '', buttons: messageButtons(name, args) };
  }

  function describeDialog(dialog, index) {
    var out = { index: index, title: dialog.title };
    if (dialog.text) out.text = dialog.text;
    out.buttons = dialog.buttons;
    if (dialog.file) out.file_field = true;
    return out;
  }

  // What the app gets back for the button at `position`.
  function answerFor(dialog, position, path) {
    var label = dialog.buttons[position];
    if (dialog.file) {
      if (position !== 0) return null;
      var chosen = path || dialog.fallback;
      if (!chosen || !/^(\/|[A-Za-z]:[\\/])/.test(chosen)) {
        throw new Error('this dialog needs a full path - pass `path`');
      }
      return dialog.many ? [chosen] : chosen;
    }
    // `ask` and `confirm` answer whether the first button was pressed;
    // `message` answers with the button itself.
    return dialog.answers === 'message' ? label : position === 0;
  }

  // Tauri's own functions in the page cannot be replaced, so the calls are
  // caught one step further down, at the two ways a command leaves the page:
  // a request to the `ipc` scheme, and a message to the webview's handler.

  function hold(command, args, resolve) {
    var dialog = heldDialog(command, args || {});
    if (!dialog) return false;
    dialog.resolve = resolve;
    dialogs.push(dialog);
    return true;
  }

  function commandOf(url) {
    var match = /^(?:ipc:\/\/localhost|https?:\/\/ipc\.localhost)\/(.+)$/.exec(String(url));
    return match ? decodeURIComponent(match[1]) : null;
  }

  var fetchHeld = false;
  var messageHeld = false;

  function holdDialogs() {
    if (!fetchHeld && typeof window.fetch === 'function') {
      var originalFetch = window.fetch;
      window.fetch = function (input, init) {
        var command = commandOf(input);
        if (command && init && typeof init.body === 'string') {
          var args;
          try { args = JSON.parse(init.body); } catch (e) { args = null; }
          var answered;
          var pending = new Promise(function (resolve) { answered = resolve; });
          if (args && hold(command, args, function (answer) {
            answered(new Response(JSON.stringify(answer), {
              status: 200, headers: { 'Content-Type': 'application/json', 'Tauri-Response': 'ok' },
            }));
          })) return pending;
        }
        return originalFetch.apply(this, arguments);
      };
      fetchHeld = true;
    }

    var handler = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.ipc;
    if (!messageHeld && handler && typeof handler.postMessage === 'function') {
      var originalPost = handler.postMessage;
      var post = function (data) {
        var message;
        try { message = typeof data === 'string' ? JSON.parse(data) : null; } catch (e) { message = null; }
        if (message && typeof message.cmd === 'string' && hold(message.cmd, message.payload, function (answer) {
          window.__TAURI_INTERNALS__.runCallback(message.callback, answer);
        })) return;
        return originalPost.apply(handler, arguments);
      };
      try { handler.postMessage = post; } catch (e) { /* tried below */ }
      if (handler.postMessage !== post) {
        try { Object.defineProperty(handler, 'postMessage', { value: post, configurable: true }); } catch (e) { /* stays native */ }
      }
      messageHeld = handler.postMessage === post;
    }
  }
  holdDialogs();
  document.addEventListener('DOMContentLoaded', holdDialogs);

  // ── Evaluation ─────────────────────────────────────────────────────────

  function describe(value, byValue) {
    if (value === undefined) return { type: 'undefined' };
    if (value === null) return { type: 'object', subtype: 'null', value: null };
    var type = typeof value;
    if (byValue) {
      var text = JSON.stringify(value);
      return text === undefined ? { type: 'undefined' } : { type: type, value: JSON.parse(text) };
    }
    if (type === 'number' && !isFinite(value)) return { type: type, unserializableValue: String(value) };
    if (type !== 'object' && type !== 'function') return { type: type, value: type === 'bigint' ? String(value) : value };
    var id = 'o' + nextObject++;
    objects[id] = value;
    return { type: type, objectId: id, description: Object.prototype.toString.call(value) };
  }

  function mouseTarget(x, y) {
    return document.elementFromPoint(x, y) || document.body;
  }

  function fire(target, type, Ctor, x, y, bubbles) {
    target.dispatchEvent(new Ctor(type, {
      bubbles: bubbles, cancelable: true, composed: true, view: window,
      clientX: x, clientY: y, pointerType: 'mouse', isPrimary: true,
    }));
  }

  window.__emeraldBridge = {
    // Asked once per run, right after it: whether the body parsed. Taken
    // back as it is answered, so the answer stays the same however soon the
    // body finishes - a reply cannot clear it first and look like a parse error.
    started: function (id) {
      var ran = !!started[id];
      delete started[id];
      return ran;
    },

    probe: function (on) {
      probing = on;
    },

    run: function (id, options, body) {
      started[id] = true;
      var reply = function (outcome) {
        invoke('devbridge_reply', { id: id, payload: JSON.stringify(outcome) });
      };
      Promise.resolve()
        .then(body)
        .then(function (value) {
          return { result: describe(value, options.returnByValue) };
        })
        .catch(function (e) {
          return { exceptionDetails: { text: 'Uncaught', exception: { description: errorText(e) } } };
        })
        .then(reply);
    },

    object: function (id) {
      if (!(id in objects)) throw new Error('the object is no longer available');
      return objects[id];
    },

    release: function () {
      objects = {};
    },

    dialogs: function () {
      holdDialogs();
      // The newest first, as a dialog opened by another lies on top of it.
      return dialogs.slice().reverse().map(describeDialog);
    },

    answerDialog: function (p) {
      var open = dialogs.slice().reverse();
      var dialog = open[p.index || 0];
      if (!dialog) throw new Error('no dialog ' + (p.index || 0) + ' - ' + open.length + ' open');
      if (p.path != null && !dialog.file) throw new Error('this dialog has no file name field to put a path into');
      var labels = dialog.buttons.map(function (label) { return label.toLowerCase(); });
      var position;
      if (p.action === 'accept') position = 0;
      else if (p.action === 'cancel') {
        position = labels.indexOf('cancel');
        if (position < 0) position = dialog.buttons.length - 1;
      } else if (p.action === 'click') {
        if (!p.button) throw new Error("action 'click' needs the button's label");
        var wanted = String(p.button).trim().toLowerCase();
        position = labels.indexOf(wanted);
        if (position < 0) position = labels.findIndex(function (label) { return label.indexOf(wanted) === 0; });
        if (position < 0) throw new Error('no button "' + p.button + '" - this dialog has: ' + dialog.buttons.join(', '));
      } else throw new Error('unknown action "' + p.action + '" - list, accept, cancel or click');

      var answer = answerFor(dialog, position, p.path);
      dialogs.splice(dialogs.indexOf(dialog), 1);
      dialog.resolve(answer);
      return { pressed: dialog.buttons[position], closed: true };
    },

    layoutMetrics: function () {
      return {
        cssVisualViewport: {
          pageX: window.scrollX, pageY: window.scrollY,
          clientWidth: window.innerWidth, clientHeight: window.innerHeight,
        },
      };
    },

    // The webview takes no input from outside, so the pointer is events
    // dispatched at whatever lies under the point. `:hover` styles do not
    // follow; handlers do.
    mouseMoved: function (p) {
      var target = mouseTarget(p.x, p.y);
      if (target !== hovered) {
        if (hovered && hovered.isConnected) {
          fire(hovered, 'pointerout', PointerEvent, p.x, p.y, true);
          fire(hovered, 'mouseout', MouseEvent, p.x, p.y, true);
          fire(hovered, 'mouseleave', MouseEvent, p.x, p.y, false);
        }
        fire(target, 'pointerover', PointerEvent, p.x, p.y, true);
        fire(target, 'pointerenter', PointerEvent, p.x, p.y, false);
        fire(target, 'mouseover', MouseEvent, p.x, p.y, true);
        fire(target, 'mouseenter', MouseEvent, p.x, p.y, false);
        hovered = target;
      }
      fire(target, 'pointermove', PointerEvent, p.x, p.y, true);
      fire(target, 'mousemove', MouseEvent, p.x, p.y, true);
      return {};
    },

    insertText: function (p) {
      document.execCommand('insertText', false, p.text);
      return {};
    },

    key: function (p) {
      var target = document.activeElement || document.body;
      var modifiers = p.modifiers || 0;
      var init = {
        key: p.key, code: p.code, bubbles: true, cancelable: true, composed: true, view: window,
        altKey: !!(modifiers & 1), ctrlKey: !!(modifiers & 2), metaKey: !!(modifiers & 4), shiftKey: !!(modifiers & 8),
      };
      if (p.type === 'keyUp') {
        target.dispatchEvent(new KeyboardEvent('keyup', init));
        return {};
      }
      var event = new KeyboardEvent('keydown', init);
      // Read by handlers that predate `key`, and not settable through the constructor.
      var code = p.windowsVirtualKeyCode || 0;
      Object.defineProperty(event, 'keyCode', { get: function () { return code; } });
      Object.defineProperty(event, 'which', { get: function () { return code; } });
      if (!target.dispatchEvent(event)) return {};

      // A dispatched key event has no default action, so the editing a real
      // key press would do is done here.
      if (p.commands && p.commands.length) {
        p.commands.forEach(function (command) { document.execCommand(command); });
        return {};
      }
      var field = /^(INPUT|TEXTAREA)$/.test(target.tagName);
      if (!field && !target.isContentEditable) return {};
      if (p.key === 'Backspace') document.execCommand('delete');
      else if (p.key === 'Delete') document.execCommand('forwardDelete');
      else if (p.key === 'Enter') {
        if (target.isContentEditable) document.execCommand('insertParagraph');
        else if (target.tagName === 'TEXTAREA') document.execCommand('insertLineBreak');
      } else if (p.text) document.execCommand('insertText', false, p.text);
      return {};
    },
  };
})();
