import type { AltarItem } from '../types';
import { createDragChannel } from './dragChannel';

const channel = createDragChannel<AltarItem>();

export const setAltarDragItem = channel.set;
export const getAltarDragItem = channel.get;
export const subscribeAltarDrag = channel.subscribe;
