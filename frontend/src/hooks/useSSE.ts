import { useEffect, useRef, useCallback, useState } from 'react';

interface UseSSEOptions {
  onMessage?: (event: string, data: string) => void;
  onError?: (error: Event) => void;
  onOpen?: () => void;
}

export function useSSE(url: string | null, options: UseSSEOptions = {}) {
  const eventSourceRef = useRef<EventSource | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
      setIsConnected(false);
    }
  }, []);

  useEffect(() => {
    if (!url) {
      disconnect();
      return;
    }

    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      setIsConnected(true);
      options.onOpen?.();
    };

    eventSource.onerror = (error) => {
      setIsConnected(false);
      options.onError?.(error);
      eventSource.close();
      eventSourceRef.current = null;
    };

    // Listen for all event types
    const handleMessage = (event: MessageEvent) => {
      options.onMessage?.(event.type, event.data);
    };

    // Common event types from the server
    eventSource.addEventListener('output', handleMessage);
    eventSource.addEventListener('complete', handleMessage);
    eventSource.addEventListener('review-status', handleMessage);
    eventSource.addEventListener('status', handleMessage);
    eventSource.addEventListener('promoted', handleMessage);
    eventSource.addEventListener('queue-update', handleMessage);
    eventSource.addEventListener('error', handleMessage);
    eventSource.addEventListener('message', handleMessage);

    return () => {
      eventSource.close();
      eventSourceRef.current = null;
      setIsConnected(false);
    };
  }, [url, disconnect, options.onMessage, options.onError, options.onOpen]);

  return { isConnected, disconnect };
}

// Helper to parse agent output from the review stream
export function parseAgentOutput(data: string): string {
  const lines = data.split('\n').filter((line) => line.trim());
  let result = '';
  
  for (const line of lines) {
    if (!line.startsWith('{')) {
      result += line + '\n';
      continue;
    }
    
    try {
      const obj = JSON.parse(line);
      if (obj.type === 'text' && obj.part?.text) {
        result += obj.part.text + '\n';
      } else if (obj.type === 'tool_use' && obj.part) {
        const tool = obj.part.tool;
        const input = obj.part.state?.input || {};
        if (tool === 'read') {
          result += `📄 Reading: ${input.filePath || input.path || 'file'}\n`;
        } else if (tool === 'list') {
          result += `📁 Listing: ${input.directory || input.path || '.'}\n`;
        } else if (tool === 'glob') {
          result += `🔍 Glob: ${input.pattern || input.glob || '*'}\n`;
        } else if (tool === 'grep') {
          result += `🔎 Grep: ${input.pattern || 'pattern'}\n`;
        } else if (tool === 'submit_review') {
          result += `✅ Submitting review...\n`;
        } else {
          result += `🔧 Tool: ${tool}\n`;
        }
      } else if (obj.type === 'tool_call') {
        const tool = obj.tool || obj.name || obj.part?.tool;
        const input = obj.input || obj.args || obj.part?.input || {};
        if (tool === 'read') {
          result += `📄 Reading: ${input.filePath || input.path || 'file'}\n`;
        } else if (tool === 'list') {
          result += `📁 Listing: ${input.directory || input.path || '.'}\n`;
        } else if (tool === 'glob') {
          result += `🔍 Glob: ${input.pattern || '*'}\n`;
        } else if (tool === 'grep') {
          result += `🔎 Grep: ${input.pattern || 'pattern'}\n`;
        } else if (tool === 'submit_review') {
          result += `✅ Submitting review...\n`;
        } else if (tool) {
          result += `🔧 Tool: ${tool}\n`;
        }
      }
    } catch {
      result += line + '\n';
    }
  }
  
  return result;
}
