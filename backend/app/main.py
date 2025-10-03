from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
from app.routes.agent_routes import router as agent_router

app = FastAPI(docs_url = None, redoc_url = None)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include the agent router
app.include_router(agent_router)

@app.get('/')
async def root():
    print("Server running on port 8000")


# Create the app instance
if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
