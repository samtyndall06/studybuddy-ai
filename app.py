from flask import Flask, render_template, request, jsonify
import requests

app = Flask(__name__)

# Ollama runs locally on this URL
OLLAMA_URL = "http://localhost:11434/api/generate"

@app.route('/')
def home():
    # Renders templates/index.html
    return render_template('index.html')

@app.route('/api/chat', methods=['POST'])
def chat():
    data = request.get_json()
    user_message = data.get('message', '')

    # Send the message to Ollama
    response = requests.post(OLLAMA_URL, json={
        "model": "llama3.2",
        "prompt": user_message,
        "stream": False
    })

    if response.status_code == 200:
        ai_response = response.json().get('response', '')
        return jsonify({"reply": ai_response})
    else:
        return jsonify({"reply": "Sorry, something went wrong."}), 500

if __name__ == '__main__':
    app.run(debug=True, port=5000)