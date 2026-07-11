import { io } from 'socket.io-client';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8788';

// Single shared socket instance, connected lazily (autoConnect: false) so it only opens
// once the user has actually chosen a display name/room, not the moment the app loads.
export const socket = io(API_URL, { autoConnect: false });
