"use client";

import { useState } from "react";
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

  // Placeholder functions - you can implement these
  const handleStartCall = () => {
    setIsCallActive(true);
    setIsRecording(true);
    
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
  };

  const handleToggleMute = () => {
    setIsMuted((prev) => !prev);
  };

  return (
    <div className="flex flex-col h-full max-w-4xl mx-auto">
      {/* Header */}
      <div className="p-4 border-b">
        <h1 className="text-2xl font-bold text-center">Therapy Chat</h1>
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
