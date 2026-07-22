import { useState, useEffect, useRef, useCallback } from 'react';
import { Client, IMessage } from '@stomp/stompjs';
import SockJS from 'sockjs-client';

interface UseWebSocketOptions {
  url?: string;
  token?: string;
  onConnect?: () => void;
  onDisconnect?: () => void;
}

interface Subscription {
  destination: string;
  callback: (message: unknown) => void;
}

export function useWebSocket(options: UseWebSocketOptions = {}) {
  const {
    url = '/ws',
    token,
    onConnect,
    onDisconnect,
  } = options;

  const [connected, setConnected] = useState(false);
  const clientRef = useRef<Client | null>(null);
  const subscriptionsRef = useRef<Map<string, Subscription>>(new Map());

  useEffect(() => {
    const client = new Client({
      webSocketFactory: () => new SockJS(url),
      connectHeaders: token ? { Authorization: `Bearer ${token}` } : {},
      reconnectDelay: 5000,
      heartbeatIncoming: 10000,
      heartbeatOutgoing: 10000,
      onConnect: () => {
        setConnected(true);
        onConnect?.();
        // Re-subscribe on reconnect
        subscriptionsRef.current.forEach((sub) => {
          client.subscribe(sub.destination, (message: IMessage) => {
            try {
              sub.callback(JSON.parse(message.body));
            } catch {
              sub.callback(message.body);
            }
          });
        });
      },
      onDisconnect: () => {
        setConnected(false);
        onDisconnect?.();
      },
      onStompError: (frame) => {
        if (import.meta.env.DEV) {
          console.error('STOMP error:', frame.headers['message'], frame.body);
        }
      },
    });

    client.activate();
    clientRef.current = client;

    return () => {
      client.deactivate();
    };
  }, [url, token, onConnect, onDisconnect]);

  const subscribe = useCallback((destination: string, callback: (message: unknown) => void) => {
    subscriptionsRef.current.set(destination, { destination, callback });

    if (clientRef.current?.connected) {
      const stompSub = clientRef.current.subscribe(destination, (message: IMessage) => {
        try {
          callback(JSON.parse(message.body));
        } catch {
          callback(message.body);
        }
      });
      return () => {
        stompSub.unsubscribe();
        subscriptionsRef.current.delete(destination);
      };
    }

    return () => {
      subscriptionsRef.current.delete(destination);
    };
  }, []);

  const sendMessage = useCallback((destination: string, body: unknown) => {
    if (clientRef.current?.connected) {
      clientRef.current.publish({
        destination,
        body: typeof body === 'string' ? body : JSON.stringify(body),
      });
    }
  }, []);

  return { connected, subscribe, sendMessage };
}
