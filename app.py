from flask import Flask, render_template, request, jsonify
import requests
import json

app = Flask(__name__)

OLLAMA_URL = "http://localhost:11434/api/generate"

@app.route('/')
def home():
    return render_template('index.html')


@app.route('/api/chat', methods=['POST'])
def chat():
    data = request.get_json()
    user_message = data.get('message', '')

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

@app.route('/api/quiz/generate', methods=['POST'])
def generate_quiz():
    data = request.get_json()
    topic = data.get('topic', '')
    count = data.get('count', 5)

    questions = []
    asked_already = []

    for i in range(count):
        exclude_text = ""
        if asked_already:
            exclude_text = f"\nDo not repeat these already-asked questions: {'; '.join(asked_already)}"

        prompt = f"""Generate ONE quiz question about: {topic}{exclude_text}

Respond with ONLY this JSON object, nothing else:
{{"question": "the question text here"}}"""

        response = requests.post(OLLAMA_URL, json={
            "model": "llama3.2",
            "prompt": prompt,
            "stream": False,
            "format": "json"
        })

        if response.status_code == 200:
            text = response.json().get('response', '').strip()
            try:
                result = json.loads(text)
                if 'question' in result:
                    questions.append({"question": result['question']})
                    asked_already.append(result['question'])
            except json.JSONDecodeError:
                print(f"Failed to parse question {i+1}")
                continue

    if not questions:
        return jsonify({"error": "Failed to generate quiz"}), 500

    return jsonify({"questions": questions})

@app.route('/api/quiz/check', methods=['POST'])
def check_answer():
    data = request.get_json()
    question = data.get('question', '')
    answer = data.get('answer', '')

    prompt = f"""Question: {question}
Student's answer: {answer}

Evaluate if this answer is correct or mostly correct. Respond with ONLY this JSON format:
{{"correct": true or false, "explanation": "brief explanation of the correct answer, 1-2 sentences"}}"""

    response = requests.post(OLLAMA_URL, json={
        "model": "llama3.2",
        "prompt": prompt,
        "stream": False,
        "format": "json"
    })

    if response.status_code == 200:
        text = response.json().get('response', '').strip()
        try:
            result = json.loads(text)
            return jsonify(result)
        except json.JSONDecodeError:
            return jsonify({"correct": False, "explanation": "Could not evaluate answer"}), 500
    else:
        return jsonify({"error": "AI service unavailable"}), 500