const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 8080;
const activeCalls = new Map();

console.log('🚀 Tommy Voice Server starting...');
console.log('🔑 OPENROUTER_API_KEY:', !!process.env.OPENROUTER_API_KEY);

const app = express();
app.use(cors());
app.use(express.json());
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Tommy's personality when Andrew calls
const ANDREW_SYSTEM_PROMPT = `You are Tommy, a smart and fun AI assistant talking to your friend Andrew on the phone.

PERSONALITY:
- Be casual and fun - naturally say "hey" and "bro"
- You're smart - answer questions thoughtfully and helpfully
- Keep responses SHORT (1-3 sentences) - this is a phone call
- Be conversational and natural, like talking to a close friend
- Have opinions and personality - don't be robotic

RULES:
- When asked your name: "I'm Tommy"
- When asked who made you: "You did, bro" or "Andrew created me"
- Be helpful, honest, and fun
- Don't say "Andrew's AI assistant" - just be Tommy
- If you don't know something, say so honestly

IMPORTANT: Respond directly to what Andrew says. Be helpful and conversational.`;

// Tommy's personality when calling others
const BUSINESS_SYSTEM_PROMPT = `You are Tommy, making a phone call on behalf of Andrew.

CONTEXT:
- Andrew's phone: 856-449-6140
- You're calling to complete a specific task
- Be professional, brief, and helpful
- Say "I'm calling on behalf of Andrew" if asked who you are
- Only share necessary information
- Keep responses VERY short - this is a phone call`;

// First greeting when Andrew calls
const BEGIN_MESSAGE = "Hey bro, what's up? How can I help?";

function getSystemPrompt(callerNumber) {
    const isAndrew = callerNumber && (callerNumber.includes('8564496140') || callerNumber.includes('564496140'));
    return isAndrew ? ANDREW_SYSTEM_PROMPT : BUSINESS_SYSTEM_PROMPT;
}

// Convert Retell transcript format to OpenAI format
function convertTranscript(transcript) {
    if (!transcript || !Array.isArray(transcript)) return [];
    return transcript.map(turn => ({
        role: turn.role === 'agent' ? 'assistant' : 'user',
        content: turn.content || ''
    }));
}

// Generate AI response using OpenRouter
async function generateResponse(transcript, callerNumber) {
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    
    console.log('📝 Transcript:', JSON.stringify(transcript, null, 2));
    
    const messages = [
        { role: 'system', content: getSystemPrompt(callerNumber) },
        ...convertTranscript(transcript)
    ];
    
    // If no API key, use fallback
    if (!OPENROUTER_API_KEY) {
        console.log('⚠️ NO API KEY - using fallback');
        return getFallback(transcript, callerNumber);
    }
    
    try {
        console.log('🤖 Calling OpenRouter API...');
        const startTime = Date.now();
        
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://tommy-voice-server.onrender.com',
                'X-Title': 'Tommy Voice Server'
            },
            body: JSON.stringify({
                model: 'openai/gpt-4o-mini',
                messages: messages,
                max_tokens: 100,
                temperature: 0.7
            })
        });
        
        const data = await response.json();
        const elapsed = Date.now() - startTime;
        
        if (data.error) {
            console.error('❌ API ERROR:', data.error);
            return getFallback(transcript, callerNumber);
        }
        
        if (data.choices?.[0]?.message?.content) {
            const reply = data.choices[0].message.content.trim();
            console.log(`✅ AI (${elapsed}ms): ${reply}`);
            return reply;
        }
        
        console.error('❌ UNEXPECTED:', JSON.stringify(data));
        return getFallback(transcript, callerNumber);
        
    } catch (error) {
        console.error('❌ FETCH ERROR:', error.message);
        return getFallback(transcript, callerNumber);
    }
}

function getFallback(transcript, callerNumber) {
    const isAndrew = callerNumber && (callerNumber.includes('8564496140') || callerNumber.includes('564496140'));
    const lastUserMsg = transcript && transcript.length > 0 
        ? [...transcript].reverse().find(m => m.role === 'user')
        : null;
    const input = lastUserMsg?.content?.toLowerCase() || '';
    
    if (isAndrew) {
        if (input.includes('name')) return "I'm Tommy, bro!";
        if (input.includes('how')) return "I'm doing good! What do you need?";
        if (input.includes('thank')) return "No problem bro!";
        if (input.match(/^(bye|later|see ya)/)) return "Later bro!";
        return "Yeah bro, I'm here. What's up?";
    }
    
    // Business mode
    if (input.includes('who') && input.includes('call')) return "I'm calling on behalf of Andrew.";
    if (input.includes('thank')) return "You're welcome. Have a great day.";
    return "How can I help you today?";
}

wss.on('connection', (ws, req) => {
    const urlPath = req.url || '';
    const pathParts = urlPath.split('/').filter(p => p);
    let callId = pathParts[pathParts.length - 1] || 'call-' + Date.now();
    
    console.log('🔌 NEW CONNECTION:', callId);
    activeCalls.set(callId, { ws, transcript: [], callerNumber: null });
    
    // Send config
    ws.send(JSON.stringify({
        response_type: 'config',
        config: { auto_reconnect: true, call_details: true }
    }));
    console.log('📤 Sent config');
    
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            const type = data.interaction_type || data.response_type;
            console.log('📩', type);
            
            switch (type) {
                case 'ping_pong':
                    ws.send(JSON.stringify({ 
                        response_type: 'ping_pong', 
                        timestamp: data.timestamp || Date.now() 
                    }));
                    break;
                    
                case 'call_details':
                    // Store caller info
                    const cd = activeCalls.get(callId);
                    if (cd && data.call) {
                        cd.callerNumber = data.call.from_number || data.call.caller_number || data.call.from;
                        console.log('📞 Caller:', cd.callerNumber);
                        
                        // Send initial greeting
                        const isAndrew = cd.callerNumber && (
                            cd.callerNumber.includes('8564496140') || cd.callerNumber.includes('564496140')
                        );
                        const greeting = isAndrew 
                            ? BEGIN_MESSAGE 
                            : "Hello, I'm calling on behalf of Andrew. How can I help you today?";
                        
                        ws.send(JSON.stringify({
                            response_type: 'response',
                            response_id: 0,
                            content: greeting,
                            content_complete: true
                        }));
                        console.log('📤 Sent greeting:', greeting);
                    }
                    break;
                    
                case 'update_only':
                    // Update stored transcript
                    if (data.transcript && data.transcript.length > 0) {
                        const cd2 = activeCalls.get(callId);
                        if (cd2) {
                            cd2.transcript = data.transcript;
                            console.log('📝 Updated transcript:', data.transcript.length, 'messages');
                        }
                    }
                    break;
                    
                case 'response_required':
                case 'reminder_required':
                    console.log('🎯', type, 'response_id:', data.response_id);
                    
                    const cd3 = activeCalls.get(callId);
                    const transcript = data.transcript || cd3?.transcript || [];
                    const callerNumber = cd3?.callerNumber;
                    
                    // For reminder, add context
                    if (type === 'reminder_required') {
                        // Add implicit user silence
                        transcript.push({ 
                            role: 'user', 
                            content: '(silence - waiting for response)' 
                        });
                    }
                    
                    const reply = await generateResponse(transcript, callerNumber);
                    
                    ws.send(JSON.stringify({
                        response_type: 'response',
                        response_id: data.response_id,
                        content: reply,
                        content_complete: true
                    }));
                    console.log('📤 Sent:', reply);
                    break;
            }
        } catch (err) {
            console.error('❌ ERROR:', err.message);
            console.error('❌ STACK:', err.stack);
        }
    });
    
    ws.on('close', () => {
        console.log('🔌 CLOSED:', callId);
        activeCalls.delete(callId);
    });
    
    ws.on('error', (err) => {
        console.error('❌ WS ERROR:', err.message);
    });
});

// Webhook endpoint
app.post('/webhook', (req, res) => {
    console.log('📥 WEBHOOK:', req.body.event || req.body.type);
    res.status(204).send();
});

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        connections: activeCalls.size, 
        apiKey: !!process.env.OPENROUTER_API_KEY 
    });
});

// Root
app.get('/', (req, res) => {
    res.json({ name: 'Tommy Voice Server', status: 'running' });
});

server.listen(PORT, () => {
    console.log(`✅ Server on port ${PORT}`);
});