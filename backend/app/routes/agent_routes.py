from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
import asyncio
import json
import os
import base64
from typing import Optional
from dotenv import load_dotenv
from deepgram import (
    DeepgramClient,
    DeepgramClientOptions,
    LiveTranscriptionEvents,
    LiveOptions,
)
from app.agent.agent import generate_response

load_dotenv()

router = APIRouter()

deepgram: DeepgramClient = DeepgramClient(os.getenv('DEEPGRAM_API_KEY'))

@router.websocket("/ws/audio")
async def websocket_audio_endpoint(websocket: WebSocket):
    await websocket.accept()
    
    dg_connection = None
    
    try:
        dg_connection = deepgram.listen.websocket.v("1")
        
        options = LiveOptions(
            model="nova-3",
            language="en-US",
            smart_format=True,
            encoding="linear16",
            channels=1,
            sample_rate=16000,
            interim_results=True,
            utterance_end_ms="1000",
            vad_events=True,
            endpointing=300
        )
        
        loop = asyncio.get_running_loop()

        def on_message(self, result, **_):
            try:
                sentence = result.channel.alternatives[0].transcript
                if len(sentence) == 0:
                    return
                
                print(f"🎤 Received transcript: '{sentence}' (final: {result.is_final})")
                
                response = {
                    "type": "transcription",
                    "text": sentence,
                    "is_final": result.is_final,
                }

                try:
                    asyncio.run_coroutine_threadsafe(
                        websocket.send_text(json.dumps(response)), loop
                    )
                except Exception as ws_error:
                    print(f"❌ Failed to send transcript to frontend: {ws_error}")
                
                if result.is_final:
                    print(f"🔄 Generating agent response for final transcript: '{sentence}'")
                    try:
                        agent_response = generate_response(sentence)
                        
                        # Gemini returns base64 in agent_response already; include mime_type if present
                        audio_b64 = agent_response.get("audio_data")
                        # Ensure audio is base64 string for JSON serialization
                        if isinstance(audio_b64, (bytes, bytearray)):
                            try:
                                audio_b64 = base64.b64encode(audio_b64).decode('utf-8')
                            except Exception as enc_err:
                                print(f"❌ Failed to base64-encode audio bytes: {enc_err}")
                                audio_b64 = None
                        audio_mime = agent_response.get("audio_mime_type")

                        agent_message = {
                            "type": "agent_response",
                            "text": agent_response["text"],
                            "audio_data": audio_b64,
                            "audio_mime_type": audio_mime,
                            "is_final": True
                        }
                        
                        try:
                            asyncio.run_coroutine_threadsafe(
                                websocket.send_text(json.dumps(agent_message)), loop
                            )
                            print(f"🤖 Agent response sent: {agent_response['text']}")
                            if audio_b64:
                                print(f"🔊 Audio data included (base64 length: {len(audio_b64)})")
                        except Exception as ws_error:
                            print(f"❌ Failed to send agent response: {ws_error}")
                        
                    except Exception as agent_error:
                        print(f"❌ Error generating agent response: {agent_error}")
                
            except Exception as e:
                print(f"❌ Error in transcription handler: {e}")
        
        def on_error(self, error, **_):
            print(f"❌ Deepgram error: {error}")
        
        def on_open(self, open_event, **_):
            print("✅ Deepgram connection opened successfully")
        
        def on_close(self, close_event, **_):
            print("🔌 Deepgram connection closed")
        
        # Register event handlers
        dg_connection.on(LiveTranscriptionEvents.Open, on_open)
        dg_connection.on(LiveTranscriptionEvents.Transcript, on_message)
        dg_connection.on(LiveTranscriptionEvents.Error, on_error)
        dg_connection.on(LiveTranscriptionEvents.Close, on_close)
        
        # Start Deepgram connection
        if dg_connection.start(options) is False:
            print("Failed to start Deepgram connection")
            await websocket.close(code=1000)
            return
        
        print("Deepgram connection started successfully")
        
        # Listen for audio data from frontend
        audio_chunk_count = 0
        while True:
            try:
                # Receive audio data from frontend
                audio_data = await websocket.receive_bytes()
                audio_chunk_count += 1
                
                # Send audio data to Deepgram
                if dg_connection and len(audio_data) > 0:
                    dg_connection.send(audio_data)
                        
            except WebSocketDisconnect:
                print("🔌 WebSocket disconnected")
                break
            except Exception as e:
                print(f"❌ Error receiving audio data: {e}")
                break
    
    except Exception as e:
        print(f"Error in WebSocket endpoint: {e}")
    
    finally:
        if dg_connection:
            try:
                # Wait a few seconds for all results to arrive
                await asyncio.sleep(2)
                dg_connection.finish()
                print("Deepgram connection closed")
            except Exception as e:
                print(f"Error closing Deepgram connection: {e}")
        try:
            await websocket.close()
        except Exception as e:
            print(f"Error closing WebSocket: {e}")


@router.get("/health")
async def health_check():
    return {"status": "healthy", "message": "Agent routes are working"}