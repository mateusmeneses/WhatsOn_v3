import { io, type Socket } from "socket.io-client";
import { API_URL } from "@/lib/api";

/** `getToken` é chamado a cada (re)conexão, então o socket sempre usa o token mais recente. */
export function createSocket(getToken: () => string | null): Socket {
  return io(API_URL || undefined, {
    auth: (cb) => cb({ token: getToken() }),
    transports: ["websocket"],
  });
}
