from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
import requests
import os

app = Flask(__name__, template_folder='public', static_folder='public/static')
CORS(app)  # Enable CORS for all routes

# OpenRouter API configuration
OPENROUTER_API_KEY = "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"
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

# Store conversation history
conversations = {}


@app.route('/')
def index():
    return render_template('chat.html')


@app.route('/chat', methods=['POST'])
def chat():
    data = request.json
    user_prompt = data.get('prompt', '')
    conversation_id = data.get('conversation_id', 'default')

    # Basic validation
    if not user_prompt or len(user_prompt) > 1000:
        return jsonify({"response": "Invalid input. Please provide a prompt between 1-1000 characters."}), 400

    # Initialize conversation if it doesn't exist
    if conversation_id not in conversations:
        conversations[conversation_id] = [
            {"role": "system", "content": " Provide responses in plain text only. Do not use any Markdown formatting like bold (**text**), italics (*text*), lists, or headers."}
        ]

    # Add user message to conversation
    conversations[conversation_id].append(
        {"role": "user", "content": user_prompt})

    # Call the OpenRouter API
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        # Update with your actual domain if hosted
        "HTTP-Referer": "http://localhost:5000",
        "X-Title": "MyChatBot"
    }

    data = {
        "model": "deepseek/deepseek-chat-v3-0324:free",
        "messages": conversations[conversation_id]
    }

    try:
        response = requests.post(OPENROUTER_URL, headers=headers, json=data)
        if response.status_code == 200:
            response_json = response.json()
            # Debug print to see the full response structure
            print("API Response:", response_json)
            bot_response = response_json['choices'][0]['message']['content'].strip(
            )
            # Add bot response to conversation history
            conversations[conversation_id].append(
                {"role": "assistant", "content": bot_response})
            return jsonify({"response": bot_response})
        else:
            return jsonify({"response": f"Error {response.status_code}: {response.text}"})
    except Exception as e:
        return jsonify({"response": f"Error: {str(e)}"})


if __name__ == '__main__':
    app.run(debug=True, host="0.0.0.0", port=5001)
