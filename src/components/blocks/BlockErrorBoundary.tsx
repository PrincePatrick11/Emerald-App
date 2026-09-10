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
 * Fängt einen Block ab, dessen Darstellung wirft — kaputte Daten aus einem
 * Import, ein Fehler in einem Blocktyp. Statt der ganzen App fällt nur dieser
 * Block aus und zeigt seinen bereinigten Fallback, wie ein unbekannter Typ.
 * Ohne das nähme ein einziger Block die Oberfläche mit, und weil der Tab beim
 * Start wiederhergestellt wird, bei jedem Start erneut.
 *
 * Der Stapel schlüsselt die Grenze pro Block; ein ersetzter Block (neue Daten)
 * bekommt über `componentDidUpdate` eine neue Chance.
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
