from flask import Flask, render_template, request, jsonify
import requests
import json
import sqlite3
import os
import pdfplumber
from werkzeug.utils import secure_filename

app = Flask(__name__)

OLLAMA_URL = "http://localhost:11434/api/generate"
UPLOAD_FOLDER = 'uploads'
ALLOWED_EXTENSIONS = {'pdf', 'txt'}
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

# Store extracted text from uploaded documents in memory
document_store = {}

DATABASE = 'studybuddy.db'

def get_db():
    db = sqlite3.connect(DATABASE)
    db.row_factory = sqlite3.Row
    return db

def init_db():
    db = get_db()
    db.execute('''CREATE TABLE IF NOT EXISTS flashcards
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  front TEXT NOT NULL,
                  back TEXT NOT NULL,
                  topic TEXT,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
    db.execute('''CREATE TABLE IF NOT EXISTS notes
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  title TEXT NOT NULL,
                  content TEXT NOT NULL,
                  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
    db.commit()
    db.close()

init_db()

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


@app.route('/')
def home():
    return render_template('index.html')


@app.route('/api/chat', methods=['POST'])
def chat():
    data = request.get_json()
    user_message = data.get('message', '')
    selected_doc = data.get('document', None)

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

    try:
        if filename.lower().endswith('.pdf'):
            text = extract_text_from_pdf(filepath)
        else:
            with open(filepath, 'r', encoding='utf-8') as f:
                text = f.read()

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


@app.route('/api/flashcards', methods=['GET'])
def get_flashcards():
    db = get_db()
    flashcards = db.execute('SELECT * FROM flashcards ORDER BY created_at DESC').fetchall()
    db.close()
    return jsonify([dict(f) for f in flashcards])


@app.route('/api/flashcards', methods=['POST'])
def add_flashcard():
    data = request.get_json()
    front = data.get('front', '')
    back = data.get('back', '')
    topic = data.get('topic', '')

    if not front or not back:
        return jsonify({"error": "Front and back are required"}), 400

    db = get_db()
    db.execute('INSERT INTO flashcards (front, back, topic) VALUES (?, ?, ?)',
               (front, back, topic))
    db.commit()
    db.close()
    return jsonify({"message": "Flashcard saved!"})


@app.route('/api/flashcards/<int:id>', methods=['DELETE'])
def delete_flashcard(id):
    db = get_db()
    db.execute('DELETE FROM flashcards WHERE id = ?', (id,))
    db.commit()
    db.close()
    return jsonify({"message": "Flashcard deleted"})


@app.route('/api/flashcards/generate', methods=['POST'])
def generate_flashcard():
    data = request.get_json()
    topic = data.get('topic', '')
    count = int(data.get('count', 1))
    selected_doc = data.get('document', None)

    context = ""
    if selected_doc and selected_doc in document_store:
        context = f"Based on this content:\n{document_store[selected_doc]}\n\n"

    flashcards = []
    generated_fronts = []

    for i in range(count):
        exclude_text = ""
        if generated_fronts:
            exclude_text = f"\nDo not repeat these already-generated terms: {'; '.join(generated_fronts)}"

        prompt = f"""{context}Create ONE flashcard about: {topic}{exclude_text}

Respond with ONLY this JSON format:
{{"front": "question or term here", "back": "answer or definition here"}}"""

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
                if 'front' in result and 'back' in result:
                    flashcards.append(result)
                    generated_fronts.append(result['front'])
            except json.JSONDecodeError:
                continue

    if not flashcards:
        return jsonify({"error": "Failed to generate flashcards"}), 500

    return jsonify({"flashcards": flashcards})


@app.route('/api/notes', methods=['GET'])
def get_notes():
    db = get_db()
    notes = db.execute('SELECT * FROM notes ORDER BY created_at DESC').fetchall()
    db.close()
    return jsonify([dict(n) for n in notes])


@app.route('/api/notes', methods=['POST'])
def add_note():
    data = request.get_json()
    title = data.get('title', '')
    content = data.get('content', '')

    if not title or not content:
        return jsonify({"error": "Title and content are required"}), 400

    db = get_db()
    db.execute('INSERT INTO notes (title, content) VALUES (?, ?)', (title, content))
    db.commit()
    db.close()
    return jsonify({"message": "Note saved!"})


@app.route('/api/notes/<int:id>', methods=['DELETE'])
def delete_note(id):
    db = get_db()
    db.execute('DELETE FROM notes WHERE id = ?', (id,))
    db.commit()
    db.close()
    return jsonify({"message": "Note deleted"})

@app.route('/api/greeting', methods=['POST'])
def get_greeting():
    data = request.get_json()
    name = data.get('name', 'there')
    
    prompt = f"""Generate a short, friendly greeting for a student named {name} who is about to study.
    
Respond with ONLY this JSON format:
{{"line1": "Hello, {name}!", "line2": "short motivational subtitle here"}}

The line2 should be encouraging and study-related, max 6 words."""

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
            if 'line1' in result and 'line2' in result:
                return jsonify(result)
        except json.JSONDecodeError:
            pass

    # Fallback greeting
    return jsonify({
        "line1": f"Hello, {name}!",
        "line2": "How can I help you today?"
    })

if __name__ == '__main__':
    app.run(debug=True, port=5000)