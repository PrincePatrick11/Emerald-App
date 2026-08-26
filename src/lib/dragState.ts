import type { SuggestionItem } from '../components/editor/SuggestionList';
import { createDragChannel } from './dragChannel';

const channel = createDragChannel<SuggestionItem>();

export const setDragItem = channel.set;
export const getDragItem = channel.get;
export const subscribeDrag = channel.subscribe;
