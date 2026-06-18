from flask import Flask, render_template, request, jsonify
import requests
import json
import os
import pdfplumber
from werkzeug.utils import secure_filename

app = Flask(__name__)

UPLOAD_FOLDER = 'uploads'
ALLOWED_EXTENSIONS = {'pdf', 'txt'}
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

# Store extracted text from uploaded documents in memory
# Key: filename, Value: extracted text content
document_store = {}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def extract_text_from_pdf(filepath):
    text = ""
    with pdfplumber.open(filepath) as pdf:
        for page in pdf.pages:
            page_text = page.extract_text()
            if page_text:
                text += page_text + "\n"
    return text

OLLAMA_URL = "http://localhost:11434/api/generate"

@app.route('/')
def home():
    return render_template('index.html')


@app.route('/api/chat', methods=['POST'])
def chat():
    data = request.get_json()
    user_message = data.get('message', '')
    selected_doc = data.get('document', None)

    # Build context from selected document if one was chosen
    context = ""
    if selected_doc and selected_doc in document_store:
        context = f"Use this document content to help answer the question:\n\n{document_store[selected_doc]}\n\n"

    full_prompt = context + "Question: " + user_message if context else user_message

    response = requests.post(OLLAMA_URL, json={
        "model": "llama3.2",
        "prompt": full_prompt,
        "stream": False
    })

    if response.status_code == 200:
        ai_response = response.json().get('response', '')
        return jsonify({"reply": ai_response})
    else:
        return jsonify({"reply": "Sorry, something went wrong."}), 500

@app.route('/api/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files['file']

    if file.filename == '':
        return jsonify({"error": "No file selected"}), 400

    if not allowed_file(file.filename):
        return jsonify({"error": "Only PDF and TXT files are allowed"}), 400

    filename = secure_filename(file.filename)
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    file.save(filepath)

    # Extract text based on file type
    try:
        if filename.lower().endswith('.pdf'):
            text = extract_text_from_pdf(filepath)
        else:
            with open(filepath, 'r', encoding='utf-8') as f:
                text = f.read()

        # Store extracted text, limited to avoid overwhelming the AI
        document_store[filename] = text[:8000]

        return jsonify({
            "message": "File uploaded successfully",
            "filename": filename,
            "preview": text[:200] + "..." if len(text) > 200 else text
        })
    except Exception as e:
        return jsonify({"error": f"Failed to process file: {str(e)}"}), 500


@app.route('/api/documents', methods=['GET'])
def list_documents():
    return jsonify({"documents": list(document_store.keys())})


@app.route('/api/documents/<filename>', methods=['DELETE'])
def delete_document(filename):
    if filename in document_store:
        del document_store[filename]
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        if os.path.exists(filepath):
            os.remove(filepath)
        return jsonify({"message": "Document removed"})
    return jsonify({"error": "Document not found"}), 404

@app.route('/api/quiz/generate', methods=['POST'])
def generate_quiz():
    data = request.get_json()
    topic = data.get('topic', '')
    count = data.get('count', 5)
    selected_doc = data.get('document', None)

    context = ""
    if selected_doc and selected_doc in document_store:
        context = f"Base the questions on this document content:\n\n{document_store[selected_doc]}\n\n"

    questions = []
    asked_already = []

    for i in range(count):
        exclude_text = ""
        if asked_already:
            exclude_text = f"\nDo not repeat these already-asked questions: {'; '.join(asked_already)}"

        prompt = f"""{context}Generate ONE quiz question about: {topic}{exclude_text}

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