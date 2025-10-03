"use client";

import { useState, useRef, useEffect } from "react";
import { Mic, MicOff, Volume2, VolumeX, Phone, PhoneOff } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Message {
  id: string;
  type: "user" | "agent";
  text: string;
  timestamp: Date;
}

export const VoiceChat = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isCallActive, setIsCallActive] = useState(false);
  const [currentUserText, setCurrentUserText] = useState("");
  const [currentAgentText, setCurrentAgentText] = useState("");
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const audioPlaybackRef = useRef<HTMLAudioElement | null>(null);

  const connectWebSocket = () => {
    const ws = new WebSocket('ws://localhost:8000/ws/audio');
    
    ws.onopen = () => {
      console.log('WebSocket connected');
    };
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'transcription') {
        setCurrentUserText(data.text);
        
        // If transcription is final, add to messages
        if (data.is_final) {
          const userMessage: Message = {
            id: `user-${Date.now()}`,
            type: "user",
            text: data.text,
            timestamp: new Date(),
          };
          setMessages((prev) => [...prev, userMessage]);
          setCurrentUserText("");
        }
      }
      
      if (data.type === 'agent_response') {
        if (typeof data.text === 'string' && data.text.trim().length > 0) {
          const agentMessage: Message = {
            id: `agent-${Date.now()}`,
            type: "agent",
            text: data.text,
            timestamp: new Date(),
          };
          setMessages((prev) => [...prev, agentMessage]);
          setCurrentAgentText("");
        }

        if (data.audio_data) {
          try {
            const mimeRaw: string | undefined = data.audio_mime_type;
            const mime = (mimeRaw || '').toLowerCase();
            const byteArray = base64ToUint8Array(data.audio_data);
            // Ensure BlobPart is a plain ArrayBuffer (avoid SharedArrayBuffer types)
            const buf = new ArrayBuffer(byteArray.byteLength);
            new Uint8Array(buf).set(byteArray);
            // Primary: produce a definitely-playable WAV when input is PCM/linear16.
            let blob: Blob;
            if (mime.includes('wav')) {
              blob = new Blob([buf], { type: 'audio/wav' });
            } else if (mime.includes('linear16') || mime.includes('pcm')) {
              const detectedRate = parseSampleRateFromMime(mime) ?? 24000;
              const wavAb = buildWavFromPCM16(new Uint8Array(buf), detectedRate, 1);
              blob = new Blob([wavAb], { type: 'audio/wav' });
            } else {
              // Non-PCM formats (mp3/ogg/etc.) use original mime
              blob = new Blob([buf], { type: mimeRaw || 'audio/mpeg' });
            }
            let url = URL.createObjectURL(blob);

            // Stop previous playback
            if (audioPlaybackRef.current) {
              try { audioPlaybackRef.current.pause(); } catch {}
              try { URL.revokeObjectURL(audioPlaybackRef.current.src); } catch {}
            }

            const audio = new Audio(url);
            audioPlaybackRef.current = audio;
            audio.volume = isMuted ? 0 : volume;
            setIsPlaying(true);
            audio.onended = () => {
              setIsPlaying(false);
              try { URL.revokeObjectURL(url); } catch {}
            };
            audio.onerror = async () => {
              // Last-resort: wrap to WAV and retry once (handles unknown PCM-like cases)
              try { URL.revokeObjectURL(url); } catch {}
              try {
                const fallbackWav = buildWavFromPCM16(new Uint8Array(buf), 24000, 1);
                const fallbackBlob = new Blob([fallbackWav], { type: 'audio/wav' });
                url = URL.createObjectURL(fallbackBlob);
                audio.src = url;
                try { await audio.play(); setIsPlaying(true); } catch { setIsPlaying(false); }
              } catch {
                setIsPlaying(false);
              }
            };
            void audio.play();
          } catch (e) {
            console.error('Failed to play agent audio:', e);
          }
        }
      }
    };
    
    ws.onclose = () => {
      console.log('WebSocket disconnected');
    };
    
    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
    
    wsRef.current = ws;
  };

  const startAudioCapture = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        } 
      });
      
      streamRef.current = stream;

      // Initialize AudioContext targeting 16 kHz; processor will resample if needed
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: 16000,
      });
      audioContextRef.current = audioContext;

      // Load worklet from public folder
      await audioContext.audioWorklet.addModule('/pcm16-processor.js');

      // Create a source from the mic stream
      const sourceNode = audioContext.createMediaStreamSource(stream);
      sourceNodeRef.current = sourceNode;

      // Create the PCM16 writer worklet
      const workletNode = new AudioWorkletNode(audioContext, 'pcm16-writer');
      workletNodeRef.current = workletNode;

      // When PCM16 buffers are available, send them over the websocket
      workletNode.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        const buffer = event.data;
        if (buffer && wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(buffer);
        }
      };

      // Connect source -> worklet (do not connect to destination to avoid echo)
      sourceNode.connect(workletNode);
      
    } catch (error) {
      console.error('Error accessing microphone:', error);
    }
  };

  const stopAudioCapture = () => {
    // Disconnect worklet and source
    try {
      if (sourceNodeRef.current && workletNodeRef.current) {
        sourceNodeRef.current.disconnect(workletNodeRef.current);
      }
    } catch {}
    workletNodeRef.current = null;
    sourceNodeRef.current = null;

    // Stop and close AudioContext
    if (audioContextRef.current) {
      const ctx = audioContextRef.current;
      audioContextRef.current = null;
      try {
        ctx.close();
      } catch {}
    }

    // Stop mic tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  };

  const handleStartCall = async () => {
    setIsCallActive(true);
    setIsRecording(true);
    
    // Connect WebSocket
    connectWebSocket();
    
    // Start audio capture
    await startAudioCapture();
    
    // Add welcome message
    const welcomeMessage: Message = {
      id: `agent-welcome-${Date.now()}`,
      type: "agent",
      text: "Hello! I'm here to listen and support you. Feel free to share whatever is on your mind.",
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, welcomeMessage]);
  };

  const handleEndCall = () => {
    setIsCallActive(false);
    setIsRecording(false);
    setIsPlaying(false);
    setCurrentUserText("");
    setCurrentAgentText("");
    
    // Stop audio capture
    stopAudioCapture();
    
    // Close WebSocket connection
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  };

  // Cleanup on component unmount
  useEffect(() => {
    return () => {
      handleEndCall();
    };
  }, []);

  const handleToggleMute = () => {
    setIsMuted((prev) => !prev);
  };

  // Reflect mute/volume changes to current playback
  useEffect(() => {
    if (audioPlaybackRef.current) {
      audioPlaybackRef.current.volume = isMuted ? 0 : volume;
    }
  }, [isMuted, volume]);

  // Helper: base64 string -> Uint8Array
  function base64ToUint8Array(base64: string): Uint8Array {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }

  // Helpers for PCM16 -> WAV wrapping (kept minimal)
  function buildWavFromPCM16(pcm16: Uint8Array, sampleRate = 16000, channels = 1): ArrayBuffer {
    const bytesPerSample = 2;
    const blockAlign = channels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = pcm16.byteLength;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(view, 8, 'WAVE');

    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);

    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);
    new Uint8Array(buffer, 44).set(pcm16);
    return buffer;
  }

  function writeString(view: DataView, offset: number, str: string) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }

  function parseSampleRateFromMime(mime: string): number | null {
    const lower = mime.toLowerCase();
    const rateMatch = lower.match(/(?:rate|samplerate)\s*=\s*(\d{3,6})/);
    if (rateMatch) {
      const n = parseInt(rateMatch[1], 10);
      if (!Number.isNaN(n) && n > 0) return n;
    }
    return null;
  }

  // WAV-only path: no PCM-to-WAV wrapping helpers needed

  return (
    <div className="flex flex-col h-full max-w-4xl mx-auto">
      {/* Header */}
      <div className="p-4 border-b">
        <h1 className="text-2xl font-bold text-center">innpae</h1>
        <p className="text-center text-muted-foreground mt-1">
          Your safe space to talk and be heard
        </p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.type === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] p-3 rounded-lg ${
                message.type === "user"
                  ? "bg-blue-500 text-white"
                  : "bg-muted text-foreground"
              }`}
            >
              <p className="text-sm">{message.text}</p>
              <span className="text-xs opacity-70 mt-1 block">
                {message.timestamp.toLocaleTimeString()}
              </span>
            </div>
          </div>
        ))}

        {/* Current partial messages */}
        {currentUserText && (
          <div className="flex justify-end">
            <div className="max-w-[80%] p-3 rounded-lg bg-blue-400 text-white opacity-70">
              <p className="text-sm">{currentUserText}</p>
              <span className="text-xs opacity-70">Speaking...</span>
            </div>
          </div>
        )}

        {currentAgentText && (
          <div className="flex justify-start">
            <div className="max-w-[80%] p-3 rounded-lg bg-muted/70 text-foreground">
              <p className="text-sm">{currentAgentText}</p>
              <span className="text-xs opacity-70">Thinking...</span>
            </div>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="p-4 border-t bg-background/50 backdrop-blur">
        <div className="flex items-center justify-center space-x-4">
          {/* Volume Control */}
          <div className="flex items-center space-x-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleToggleMute}
              disabled={!isCallActive}
            >
              {isMuted ? (
                <VolumeX className="h-4 w-4" />
              ) : (
                <Volume2 className="h-4 w-4" />
              )}
            </Button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              className="w-20"
              disabled={!isCallActive}
            />
          </div>

          {/* Main Call Button */}
          <Button
            onClick={isCallActive ? handleEndCall : handleStartCall}
            size="lg"
            variant={isCallActive ? "destructive" : "default"}
            className={`rounded-full w-16 h-16 ${
              isCallActive
                ? "bg-red-500 hover:bg-red-600"
                : "bg-green-500 hover:bg-green-600"
            }`}
          >
            {isCallActive ? (
              <PhoneOff className="h-6 w-6" />
            ) : (
              <Phone className="h-6 w-6" />
            )}
          </Button>

          {/* Mic Indicator */}
          <div className="flex items-center space-x-2">
            <div
              className={`p-2 rounded-full ${isRecording ? "bg-red-100" : "bg-muted"}`}
            >
              {isRecording ? (
                <Mic className="h-4 w-4 text-red-500" />
              ) : (
                <MicOff className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
            <span className="text-sm text-muted-foreground">
              {isRecording ? "Listening..." : "Not recording"}
            </span>
          </div>
        </div>

        {/* Status */}
        <div className="text-center mt-3">
          <span className="text-xs text-muted-foreground">
            {!isCallActive && "Ready to start"}
            {isCallActive && "Session active"}
            {isPlaying && " - Agent speaking"}
          </span>
        </div>
      </div>
    </div>
  );
};
