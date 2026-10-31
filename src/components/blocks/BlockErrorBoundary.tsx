import { Component, type ReactNode } from 'react';
import type { BlockInstance } from '../../lib/blocks/types';
import UnknownBlock from './UnknownBlock';

interface Props {
  block: BlockInstance;
  children: ReactNode;
}

interface State {
  failed: boolean;
}

/**
 * Catches a block whose rendering throws: broken data from an
 * import, a bug in a block type. Instead of the whole app, only this
 * block fails and shows its sanitised fallback, like an unknown type.
 * Without it a single block would take the UI down with it, and because the tab is
 * restored on startup, again on every startup.
 *
 * The stack keys the boundary per block; a replaced block (new data)
 * gets a new chance via `componentDidUpdate`.
 */
export default class BlockErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error(`[BlockStack] block ${this.props.block.type} failed to render:`, error);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.failed && prev.block !== this.props.block) this.setState({ failed: false });
  }

  render() {
    return this.state.failed ? <UnknownBlock block={this.props.block} /> : this.props.children;
  }
}
