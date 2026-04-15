import { io } from "socket.io-client";

const SOCKET_URL = import.meta.env.VITE_BACKEND_URL;

const socket = io(SOCKET_URL, {
  transports: ["websocket", "polling"], 
  autoConnect: true,
});

socket.on("connect", () => {
  console.log("✅ Socket connected to:", SOCKET_URL, "with ID:", socket.id);
});

export default socket;