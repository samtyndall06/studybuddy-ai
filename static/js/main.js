const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');

// ---- GREETING ----
async function loadGreeting() {
    // Check if we have a stored name
    let name = localStorage.getItem('studybuddy_name');

    if (!name) {
        // Ask for name on first visit
        name = prompt('Welcome to StudyBuddy! What\'s your name?') || 'there';
        localStorage.setItem('studybuddy_name', name);
    }

    try {
        const response = await fetch('/api/greeting', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        const data = await response.json();
        document.getElementById('greeting-line1').textContent = data.line1;
        document.getElementById('greeting-line2').textContent = data.line2;
    } catch (error) {
        document.getElementById('greeting-line1').textContent = `Hello, ${name}!`;
        document.getElementById('greeting-line2').textContent = 'How can I help you today?';
    }
}

loadGreeting();
// Set current time on the initial message
document.addEventListener('DOMContentLoaded', () => {
    const timeEl = document.getElementById('chat-time');
    if (timeEl) {
        const now = new Date();
        timeEl.textContent = now.toLocaleTimeString('en-US', {
            hour: '2-digit', minute: '2-digit', hour12: false
        });
    }
});

function getCurrentTime() {
    const now = new Date();
    return now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function addMessage(text, sender) {
    // Hide greeting when first message appears
    const greeting = document.getElementById('chat-greeting');
    if (greeting) greeting.style.display = 'none';

    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}-message`;

    if (sender === 'ai') {
        messageDiv.innerHTML = `
            <div class="message-avatar">🤖</div>
            <div class="message-content">
                <span class="message-sender">Chat assistant</span>
                <div class="message-bubble">${text}</div>
                <span class="message-time">${getCurrentTime()}</span>
            </div>
        `;
    } else {
        messageDiv.innerHTML = `
            <div class="message-content">
                <div class="message-bubble">${text}</div>
                <span class="message-time">${getCurrentTime()}</span>
            </div>
        `;
    }

    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function showTyping() {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message ai-message';
    messageDiv.id = 'typing-indicator';
    messageDiv.innerHTML = `
        <div class="message-avatar">🤖</div>
        <div class="message-content">
            <span class="message-sender">Chat assistant</span>
            <div class="typing-indicator">
                <span></span><span></span><span></span>
            </div>
        </div>
    `;
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function removeTyping() {
    const typing = document.getElementById('typing-indicator');
    if (typing) typing.remove();
}

async function sendMessage() {
    const message = chatInput.value.trim();
    if (!message) return;
    addMessage(message, 'user');
    chatInput.value = '';
    sendBtn.disabled = true;
    showTyping();
    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, document: selectedDocument })
        });
        const data = await response.json();
        removeTyping();
        addMessage(data.reply, 'ai');
    } catch (error) {
        removeTyping();
        addMessage('Sorry, something went wrong. Make sure Ollama is running.', 'ai');
    }
    sendBtn.disabled = false;
    chatInput.focus();
}

sendBtn.addEventListener('click', sendMessage);
chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const mode = btn.dataset.mode;
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        const targetView = document.getElementById(`${mode}-view`);
        if (targetView) targetView.classList.add('active');
    });
});

// ---- FILE UPLOAD ----
let selectedDocument = null;
const fileUpload = document.getElementById('file-upload');
const documentList = document.getElementById('document-list');

fileUpload.addEventListener('change', async () => {
    const file = fileUpload.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    try {
        const response = await fetch('/api/upload', {
            method: 'POST',
            body: formData
        });
        const data = await response.json();
        if (response.ok) {
            addMessage(`📎 Uploaded "${data.filename}" — select it in the sidebar to ask questions about it.`, 'ai');
            loadDocuments();
        } else {
            alert(data.error || 'Upload failed');
        }
    } catch (error) {
        alert('Error uploading file');
    }
    fileUpload.value = '';
});

async function loadDocuments() {
    const response = await fetch('/api/documents');
    const data = await response.json();
    documentList.innerHTML = '';
    data.documents.forEach(filename => {
        const item = document.createElement('div');
        item.className = `document-item ${selectedDocument === filename ? 'selected' : ''}`;
        item.innerHTML = `
            <span class="document-name">📄 ${filename}</span>
            <span class="document-remove" data-filename="${filename}">✕</span>
        `;
        item.addEventListener('click', (e) => {
            if (e.target.classList.contains('document-remove')) return;
            selectedDocument = selectedDocument === filename ? null : filename;
            loadDocuments();
        });
        item.querySelector('.document-remove').addEventListener('click', async () => {
            await fetch(`/api/documents/${filename}`, { method: 'DELETE' });
            if (selectedDocument === filename) selectedDocument = null;
            loadDocuments();
        });
        documentList.appendChild(item);
    });
}

loadDocuments();

// ---- QUIZ MODE ----
let quizQuestions = [];
let currentQuestionIndex = 0;
let quizScore = 0;

const quizSetup = document.getElementById('quiz-setup');
const quizActive = document.getElementById('quiz-active');
const quizResults = document.getElementById('quiz-results');
const startQuizBtn = document.getElementById('start-quiz-btn');
const submitAnswerBtn = document.getElementById('submit-answer-btn');
const newQuizBtn = document.getElementById('new-quiz-btn');

startQuizBtn.addEventListener('click', async () => {
    const topic = document.getElementById('quiz-topic').value.trim();
    const count = document.getElementById('quiz-count').value;
    if (!topic) { alert('Please enter a topic'); return; }
    startQuizBtn.disabled = true;
    startQuizBtn.textContent = 'Generating questions...';
    try {
        const response = await fetch('/api/quiz/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ topic, count: parseInt(count), document: selectedDocument })
        });
        const data = await response.json();
        if (data.questions && data.questions.length > 0) {
            quizQuestions = data.questions;
            currentQuestionIndex = 0;
            quizScore = 0;
            showQuestion();
            quizSetup.style.display = 'none';
            quizActive.style.display = 'flex';
        } else {
            alert('Failed to generate quiz questions. Try again.');
        }
    } catch (error) {
        alert('Error generating quiz. Make sure Ollama is running.');
    }
    startQuizBtn.disabled = false;
    startQuizBtn.textContent = 'Start Quiz';
});

function showQuestion() {
    const q = quizQuestions[currentQuestionIndex];
    document.getElementById('quiz-question').textContent = q.question;
    document.getElementById('quiz-answer').value = '';
    document.getElementById('quiz-feedback').style.display = 'none';
    document.getElementById('quiz-progress-text').textContent =
        `Question ${currentQuestionIndex + 1} of ${quizQuestions.length}`;
    document.getElementById('progress-fill').style.width =
        `${((currentQuestionIndex) / quizQuestions.length) * 100}%`;
}

submitAnswerBtn.addEventListener('click', async () => {
    const answer = document.getElementById('quiz-answer').value.trim();
    if (!answer) { alert('Please enter an answer'); return; }
    submitAnswerBtn.disabled = true;
    submitAnswerBtn.textContent = 'Checking...';
    try {
        const response = await fetch('/api/quiz/check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                question: quizQuestions[currentQuestionIndex].question,
                answer
            })
        });
        const result = await response.json();
        const feedback = document.getElementById('quiz-feedback');
        feedback.style.display = 'block';
        feedback.className = `quiz-feedback ${result.correct ? 'correct' : 'incorrect'}`;
        feedback.innerHTML = `
            <div class="feedback-verdict ${result.correct ? 'correct' : 'incorrect'}">
                ${result.correct ? '✓ Correct!' : '✗ Not quite'}
            </div>
            <div class="feedback-explanation">${result.explanation}</div>
            <button id="next-question-btn">
                ${currentQuestionIndex < quizQuestions.length - 1 ? 'Next Question' : 'See Results'}
            </button>
        `;
        if (result.correct) quizScore++;
        document.getElementById('next-question-btn').addEventListener('click', () => {
            currentQuestionIndex++;
            if (currentQuestionIndex < quizQuestions.length) {
                showQuestion();
            } else {
                showResults();
            }
        });
    } catch (error) {
        alert('Error checking answer.');
    }
    submitAnswerBtn.disabled = false;
    submitAnswerBtn.textContent = 'Submit Answer';
});

function showResults() {
    quizActive.style.display = 'none';
    quizResults.style.display = 'flex';
    document.getElementById('quiz-score').textContent =
        `You scored ${quizScore} out of ${quizQuestions.length}`;
}

newQuizBtn.addEventListener('click', () => {
    quizResults.style.display = 'none';
    quizSetup.style.display = 'flex';
    document.getElementById('quiz-topic').value = '';
});

// ---- FLASHCARDS ----
let generatedFlashcard = null;

async function loadFlashcards() {
    const response = await fetch('/api/flashcards');
    const flashcards = await response.json();
    const list = document.getElementById('flashcard-list');
    const count = document.getElementById('fc-count');
    count.textContent = `(${flashcards.length})`;
    list.innerHTML = '';
    if (flashcards.length === 0) {
        list.innerHTML = '<p style="color:#6e6e73; font-size:14px;">No flashcards yet — create one!</p>';
        return;
    }
    flashcards.forEach(fc => {
        const item = document.createElement('div');
        item.className = 'flashcard-item';
        item.innerHTML = `
            <div class="fc-item-front">${fc.front}</div>
            <div class="fc-item-back" id="back-${fc.id}">${fc.back}</div>
            <div class="fc-item-footer">
                <span class="fc-topic">${fc.topic || 'General'}</span>
                <button class="fc-delete" data-id="${fc.id}">Delete</button>
            </div>
        `;
        item.addEventListener('click', (e) => {
            if (e.target.classList.contains('fc-delete')) return;
            document.getElementById(`back-${fc.id}`).classList.toggle('visible');
        });
        item.querySelector('.fc-delete').addEventListener('click', async () => {
            await fetch(`/api/flashcards/${fc.id}`, { method: 'DELETE' });
            loadFlashcards();
        });
        list.appendChild(item);
    });
}

document.querySelectorAll('.fc-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.fc-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const tabName = tab.dataset.tab;
        document.getElementById('manual-tab').style.display = tabName === 'manual' ? 'block' : 'none';
        document.getElementById('ai-tab').style.display = tabName === 'ai' ? 'block' : 'none';
    });
});

document.getElementById('save-flashcard-btn').addEventListener('click', async () => {
    const front = document.getElementById('fc-front').value.trim();
    const back = document.getElementById('fc-back').value.trim();
    const topic = document.getElementById('fc-topic').value.trim();
    if (!front || !back) { alert('Please fill in both front and back'); return; }
    await fetch('/api/flashcards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ front, back, topic })
    });
    document.getElementById('fc-front').value = '';
    document.getElementById('fc-back').value = '';
    document.getElementById('fc-topic').value = '';
    loadFlashcards();
});

document.getElementById('generate-flashcard-btn').addEventListener('click', async () => {
    const topic = document.getElementById('fc-ai-topic').value.trim();
    const count = document.getElementById('fc-ai-count').value;
    if (!topic) { alert('Please enter a topic'); return; }

    const btn = document.getElementById('generate-flashcard-btn');
    btn.disabled = true;
    btn.textContent = 'Generating...';

    const response = await fetch('/api/flashcards/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, count: parseInt(count), document: selectedDocument })
    });
    const data = await response.json();

    if (data.flashcards && data.flashcards.length > 0) {
        generatedFlashcard = data.flashcards;

        // Show preview of all generated flashcards
        const previewList = document.getElementById('fc-preview-list');
        previewList.innerHTML = '';
        data.flashcards.forEach((fc, i) => {
            const item = document.createElement('div');
            item.style.cssText = 'margin-bottom: 10px; padding: 10px; background: #0f0f14; border-radius: 8px;';
            item.innerHTML = `
                <div style="font-weight:600; font-size:13px; margin-bottom:4px;">${fc.front}</div>
                <div style="font-size:12px; color:#8e8e93;">${fc.back}</div>
            `;
            previewList.appendChild(item);
        });

        document.getElementById('fc-preview').style.display = 'block';
        document.getElementById('save-generated-btn').textContent =
            `Save All ${data.flashcards.length} Flashcards`;
    } else {
        alert('Failed to generate flashcards. Try again.');
    }

    btn.disabled = false;
    btn.textContent = 'Generate with AI';
});

document.getElementById('save-generated-btn').addEventListener('click', async () => {
    if (!generatedFlashcard || generatedFlashcard.length === 0) return;

    const topic = document.getElementById('fc-ai-topic').value.trim();

    // Save all generated flashcards
    for (const fc of generatedFlashcard) {
        await fetch('/api/flashcards', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ front: fc.front, back: fc.back, topic })
        });
    }

    document.getElementById('fc-preview').style.display = 'none';
    document.getElementById('fc-ai-topic').value = '';
    generatedFlashcard = null;
    loadFlashcards();
});

loadFlashcards();

// ---- NOTES ----
async function loadNotes() {
    const response = await fetch('/api/notes');
    const notes = await response.json();
    const container = document.getElementById('notes-container');
    container.innerHTML = '';
    if (notes.length === 0) {
        container.innerHTML = '<p style="color:#6e6e73; font-size:14px;">No notes yet — save one!</p>';
        return;
    }
    notes.forEach(note => {
        const item = document.createElement('div');
        item.className = 'note-item';
        item.innerHTML = `
            <div class="note-title">${note.title}</div>
            <div class="note-content">${note.content}</div>
            <div class="note-footer">
                <span class="note-date">${new Date(note.created_at).toLocaleDateString()}</span>
                <button class="note-delete" data-id="${note.id}">Delete</button>
            </div>
        `;
        item.querySelector('.note-delete').addEventListener('click', async () => {
            await fetch(`/api/notes/${note.id}`, { method: 'DELETE' });
            loadNotes();
        });
        container.appendChild(item);
    });
}

document.getElementById('save-note-btn').addEventListener('click', async () => {
    const title = document.getElementById('note-title').value.trim();
    const content = document.getElementById('note-content').value.trim();
    if (!title || !content) { alert('Please fill in both title and content'); return; }
    await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content })
    });
    document.getElementById('note-title').value = '';
    document.getElementById('note-content').value = '';
    loadNotes();
});

loadNotes();

document.addEventListener('DOMContentLoaded', () => {
    const themeToggle = document.getElementById('theme-toggle');
    const body = document.body;

    // 1. Check for saved theme in localStorage
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') {
        body.classList.add('light-mode');
    }

    // 2. Toggle theme on click
    themeToggle.addEventListener('click', () => {
        body.classList.toggle('light-mode');
        
        // Save the user's preference
        if (body.classList.contains('light-mode')) {
            localStorage.setItem('theme', 'light');
        } else {
            localStorage.setItem('theme', 'dark');
        }
    });
});