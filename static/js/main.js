const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');

// Add a message bubble to the chat
function addMessage(text, sender) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${sender}-message`;

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.textContent = text;

    messageDiv.appendChild(bubble);
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Show typing indicator while waiting for AI response
function showTyping() {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message ai-message';
    messageDiv.id = 'typing-indicator';

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble typing-indicator';
    bubble.innerHTML = '<span></span><span></span><span></span>';

    messageDiv.appendChild(bubble);
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function removeTyping() {
    const typing = document.getElementById('typing-indicator');
    if (typing) typing.remove();
}

// Send a message to the backend
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
            body: JSON.stringify({ message })
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

// SIDEBAR NAVIGATION
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

    if (!topic) {
        alert('Please enter a topic');
        return;
    }

    startQuizBtn.disabled = true;
    startQuizBtn.textContent = 'Generating questions...';

    try {
        const response = await fetch('/api/quiz/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ topic, count: parseInt(count) })
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
    if (!answer) {
        alert('Please enter an answer');
        return;
    }

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