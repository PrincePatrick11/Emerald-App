import { createDragChannel } from './dragChannel';

export interface RoutineDragItem {
  id: string;
  name: string;
  emoji: string;
  content: string;
  tags: string[];
  operation_ids: string[];
  wiki_ids: string[];
}

const channel = createDragChannel<RoutineDragItem>();

export const setRoutineDragItem = channel.set;
export const getRoutineDragItem = channel.get;
export const subscribeRoutineDrag = channel.subscribe;
