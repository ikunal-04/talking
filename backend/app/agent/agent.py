from google import genai
from google.genai import types
from app.agent.prompt import THINKING_AGENT
import os
from dotenv import load_dotenv

load_dotenv()

client = genai.Client(api_key=os.getenv('GEMINI_API_KEY'))

grounding_tool = types.Tool(
    google_search=types.GoogleSearch()
)

config = types.GenerateContentConfig(
    system_instruction=THINKING_AGENT,
    thinking_config=types.ThinkingConfig(thinking_budget=-1),
    tools=[grounding_tool]
)

def generate_response(question: str) -> str:
    transcript = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=question,
        config=config
    )
    
    audio_response = client.models.generate_content(
        model="gemini-2.5-flash-preview-tts",
        contents=transcript.text,
        config=types.GenerateContentConfig(
            response_modalities=["AUDIO"],
            speech_config=types.SpeechConfig(
                    voice_config=types.VoiceConfig(
                        prebuilt_voice_config=types.PrebuiltVoiceConfig(
                        voice_name='Zephyr',
                    )
                )
            ),
        )
    )

    part = audio_response.candidates[0].content.parts[0].inline_data
    response = {
        # inline_data.data is base64-encoded audio content provided by Gemini
        "audio_data": part.data,
        "audio_mime_type": getattr(part, "mime_type", None),
        "text": transcript.text,
    }
    return response
    