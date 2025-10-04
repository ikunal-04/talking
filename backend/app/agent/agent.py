import json
import os
import threading
import queue
import asyncio

import websockets
from websockets.sync.client import connect

import pyaudio

from google import genai
from google.genai import types

from app.agent.prompt import THINKING_AGENT
from dotenv import load_dotenv

load_dotenv()

TIMEOUT = 0.050
FORMAT = pyaudio.paInt16
CHANNELS = 1
RATE = 48000
CHUNK = 8000

DEFAULT_URL = f"wss://api.deepgram.com/v1/speak?model=aura-2-thalia-en&encoding=linear16&sample_rate={RATE}"
DEFAULT_TOKEN = os.environ.get("DEEPGRAM_API_KEY", None)

grounding_tool = types.Tool(
    google_search=types.GoogleSearch()
)

config = types.GenerateContentConfig(
    system_instruction=THINKING_AGENT,
    thinking_config=types.ThinkingConfig(thinking_budget=-1),
    tools=[grounding_tool]
)

def generate_response(question: str) -> dict:
    print(f"Connecting to {DEFAULT_URL}")

    client = genai.Client(api_key=os.getenv('GEMINI_API_KEY'))

    try:
        _socket = connect(
            DEFAULT_URL, additional_headers={"Authorization": f"Token {DEFAULT_TOKEN}"}
        )
        print(f"✅ Connected to Deepgram TTS WebSocket")
    except Exception as connection_error:
        print(f"❌ Failed to connect to Deepgram TTS: {connection_error}")
        return {
            "text": "Error: Could not connect to TTS service",
            "audio_data": b"",
            "audio_mime_type": "audio/linear16; rate=48000; channels=1"
        }
    
    # Collect audio data and text
    collected_audio = bytearray()
    collected_text = ""
    _exit = threading.Event()
    
    def audio_receiver():
        nonlocal collected_audio
        try:
            while not _exit.is_set():
                if _socket is None:
                    break

                try:
                    message = _socket.recv(timeout=0.5)
                except Exception as recv_error:
                    # Check if it's just a timeout
                    if "timed out" in str(recv_error).lower():
                        continue
                    else:
                        print(f"WebSocket receive error: {recv_error}")
                        break
                
                if message is None:
                    continue
                
                if type(message) is str:
                    # Deepgram sends JSON status messages
                    try:
                        status = json.loads(message)
                        print(f"Deepgram TTS status: {status}")
                        
                        # Check for completion or error status
                        if status.get('type') == 'Complete':
                            print("🎵 Deepgram TTS completed")
                        elif status.get('type') == 'Error':
                            print(f"❌ Deepgram TTS error: {status}")
                    except:
                        print(f"Deepgram TTS message: {message}")
                elif type(message) is bytes:
                    # Audio data - collect it
                    collected_audio.extend(message)
                    print(f"🔊 Collected {len(message)} bytes of audio (total: {len(collected_audio)})")
        except Exception as e:
            print(f"Audio receiver error: {e}")
    
    # Start audio collection thread
    _receiver_thread = threading.Thread(target=audio_receiver, daemon=True)
    _receiver_thread.start()

    try:
        # Generate text response first
        transcript = client.models.generate_content_stream(
            model="gemini-2.5-flash",
            contents=question,
            config=config
        )

        # Send text to Deepgram TTS and collect response text
        for chunk in transcript:
            llm_output = chunk.text

            # skip any empty responses
            if llm_output is None or llm_output == "":
                continue

            collected_text += llm_output
            
            # Clean text for TTS (remove JSON formatting if present)
            clean_text = llm_output.strip()
            
            # If the text looks like JSON, try to extract just the response content
            if clean_text.startswith('{') and 'response:' in clean_text:
                try:
                    # Extract just the response text from the JSON-like structure
                    import re
                    response_match = re.search(r'response:\s*"([^"]*)"', clean_text)
                    if response_match:
                        clean_text = response_match.group(1)
                        print(f"📝 Extracted clean text: {clean_text}")
                except Exception as clean_error:
                    print(f"Warning: Could not clean text, using original: {clean_error}")
            
            # Send to Deepgram TTS
            tts_message = {"type": "Speak", "text": clean_text}
            _socket.send(json.dumps(tts_message))
            print(f"🔊 Sent to TTS: {clean_text[:100]}..." if len(clean_text) > 100 else f"🔊 Sent to TTS: {clean_text}")

        # Send flush to complete TTS
        _socket.send(json.dumps({"type": "Flush"}))
        print("🔄 Sent flush to Deepgram TTS")

        # Wait for audio to be fully received
        import time
        max_wait = 10  # Maximum wait time in seconds
        wait_interval = 0.5
        waited = 0
        
        while waited < max_wait:
            time.sleep(wait_interval)
            waited += wait_interval
            
            # Check if we have audio data and no new data for a bit
            if len(collected_audio) > 0:
                initial_size = len(collected_audio)
                time.sleep(0.5)  # Wait a bit more
                if len(collected_audio) == initial_size:
                    # No new audio received, likely complete
                    print(f"✅ Audio collection seems complete ({len(collected_audio)} bytes)")
                    break
        
        print(f"⏱️ Waited {waited}s for audio collection")

    except Exception as e:
        print(f"LLM Exception: {e}")
    finally:
        _exit.set()
        _socket.close()
        _receiver_thread.join(timeout=3)

    # Return both text and audio data
    result = {
        "text": collected_text,
        "audio_data": bytes(collected_audio),
        "audio_mime_type": "audio/linear16; rate=48000; channels=1"
    }
    
    print(f"🎯 Final result: {len(collected_text)} chars text, {len(collected_audio)} bytes audio")
    
    # If no audio was collected, still return the text
    if len(collected_audio) == 0:
        print("⚠️ No audio data collected, but returning text response")
    
    return result

class Speaker:
    _audio: pyaudio.PyAudio
    _chunk: int
    _rate: int
    _format: int
    _channels: int
    _output_device_index: int
    
    _stream: pyaudio.Stream
    _thread: threading.Thread
    _asyncio_loop: asyncio.AbstractEventLoop
    _asyncio_thread: threading.Thread
    _queue: queue.Queue
    _exit: threading.Event

    def __init__(
        self,       
        rate: int = RATE,
        chunk: int = CHUNK,
        channels: int = CHANNELS,
        output_device_index: int = None,
    ):
        self._exit = threading.Event()
        self._queue = queue.Queue()

        self._audio = pyaudio.PyAudio()
        self._chunk = chunk
        self._rate = rate
        self._format = FORMAT
        self._channels = channels
        self._output_device_index = output_device_index

    def _start_asyncio_loop(self) -> None:
        self._asyncio_loop = asyncio.new_event_loop()
        self._asyncio_loop.run_forever()

    def start(self) -> bool:
        self._stream = self._audio.open(
            format=self._format,
            channels=self._channels,
            rate=self._rate,
            input=False,
            output=True,
            frames_per_buffer=self._chunk,
            output_device_index=self._output_device_index,
        )

        self._exit.clear()

        self._thread = threading.Thread(
            target=_play, args=(self._queue, self._stream, self._exit), daemon=True
        )

        self._thread.start()

        self._stream.start_stream()

        return True

    def stop(self):
        self._exit.set()

        if self._stream is not None:
            self._stream.stop_stream()
            self._stream.close()
            self._stream = None

        self._thread.join()
        self._thread = None

        self._queue = None

    def play(self, data):
        self._queue.put(data)
        
def _play(audio_out: queue, stream, stop):
    while not stop.is_set():
        try:
            data = audio_out.get(True, TIMEOUT)
            stream.write(data)
        except queue.Empty as e:
            # print(f"queue is empty")
            pass
        except Exception as e:
            print(f"_play: {e}")
    
    # audio_response = client.models.generate_content(
    #     model="gemini-2.5-flash-preview-tts",
    #     contents=transcript.text,
    #     config=types.GenerateContentConfig(
    #         response_modalities=["AUDIO"],
    #         speech_config=types.SpeechConfig(
    #                 voice_config=types.VoiceConfig(
    #                     prebuilt_voice_config=types.PrebuiltVoiceConfig(
    #                     voice_name='Zephyr',
    #                 )
    #             )
    #         ),
    #     )
    # )

    # part = audio_response.candidates[0].content.parts[0].inline_data
    # response = {
    #     # inline_data.data is base64-encoded audio content provided by Gemini
    #     "audio_data": part.data,
    #     "audio_mime_type": getattr(part, "mime_type", None),
    #     "text": transcript.text,
    # }
    # return response
    