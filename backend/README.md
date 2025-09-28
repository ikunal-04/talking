# Backend API

A modular Python backend API built with FastAPI.

## Project Structure

```
backend/
├── app/                    # Main application package
│   ├── __init__.py
│   ├── main.py            # FastAPI app factory
│   ├── config/            # Configuration settings
│   │   ├── __init__.py
│   │   └── settings.py    # App settings
│   ├── models/            # Data models and schemas
│   │   ├── __init__.py
│   │   └── user.py        # User model example
│   ├── routes/            # API route handlers
│   │   ├── __init__.py
│   │   ├── health.py      # Health check routes
│   │   └── users.py       # User routes
│   ├── services/          # Business logic
│   │   └── __init__.py
│   └── utils/             # Utility functions
│       ├── __init__.py
│       └── helpers.py     # Helper functions
├── main.py               # Application entry point
├── pyproject.toml        # Project dependencies
└── README.md
```

## Getting Started

1. Install dependencies:
   ```bash
   pip install -e .
   ```

2. Run the development server:
   ```bash
   python main.py
   ```

3. The API will be available at `http://localhost:8000`

## API Endpoints

- `GET /health/` - Health check
- `GET /health/ready` - Readiness check
- `GET /users/` - Get all users
- `GET /users/{user_id}` - Get user by ID
- `POST /users/` - Create new user

## Development

The project uses a modular structure where:
- **Routes** handle HTTP requests and responses
- **Models** define data schemas using Pydantic
- **Services** contain business logic
- **Utils** provide helper functions
- **Config** manages application settings
