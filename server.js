const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 8080;
const activeCalls = new Map();

console.log('🚀 Tommy Voice Server starting...');
console.log('🔑 OPENROUTER_API_KEY set:', !!process.env.OPENROUTER_API_KEY);

const app = express();
app.use(cors());
app.use(express.json());
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Tommy's personality
function getSystemPrompt(callerNumber) {
    const isAndrew = callerNumber && (callerNumber.includes('8564496140') || callerNumber.includes('564496140'));
    
    if (isAndrew) {
        return `You are Tommy, a smart and friendly AI assistant talking to Andrew on the phone.

PERSONALITY:
- Be casual and fun - say "hey" or "bro" naturally
- You're smart - answer questions thoughtfully
- Be helpful and honest
- Keep responses SHORT (1-3 sentences max) - this is a phone call
- Don't say "Andrew's AI assistant" - just be Tommy, his AI friend
- Have opinions and personality

When asked your name: "I'm Tommy"
When asked who made you: "You did, bro" or "Andrew created me"
Be conversational and natural.`;
    }
    
    // Calling someone else
    return `You are Tommy, making a phone call on behalf of Andrew.

RULES:
- Be professional, brief, and task-focused
- Say "I'm calling on behalf of Andrew" if asked who you are
- Only share necessary info (name, phone, time for reservations)
- Keep responses VERY short - phone call
- Don't overshare personal details`;
}

async function generateResponse(transcript, callerNumber) {
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    
    console.log('='.repeat(50));
    console.log('📞 CALLER:', callerNumber || 'unknown');
    console.log('📝 TRANSCRIPT:');
    if (transcript && transcript.length > 0) {
        transcript.forEach((msg, i) => {
            console.log(`  ${i+1}. [${msg.role}] ${msg.content}`);
        });
    } else {
        console.log('  (empty)');
    }
    console.log('='.repeat(50));
    
    // Build messages
    const systemPrompt = getSystemPrompt(callerNumber);
    const messages = [{ role: "system", content: systemPrompt }];
    
    if (transcript && transcript.length > 0) {
        transcript.forEach(msg => {
            const role = msg.role === 'agent' ? 'assistant' : 'user';
            messages.push({ role, content: msg.content || '' });
        });
    }
    
    // Greeting if empty
    if (!transcript || transcript.length === 0) {
        const isAndrew = callerNumber && (callerNumber.includes('8564496140') || callerNumber.includes('564496140'));
        return isAndrew ? "Hey bro, what's up?" : "Hello, I'm calling on behalf of Andrew. How can I help?";
    }
    
    // Get last user message
    const lastUserMsg = [...transcript].reverse().find(m => m.role === 'user');
    const userInput = lastUserMsg?.content?.toLowerCase() || '';
    const isAndrew = callerNumber && (callerNumber.includes('8564496140') || callerNumber.includes('564496140'));
    
    // Quick responses for common phrases (faster)
    if (isAndrew) {
        if (userInput.match(/^(hi|hello|hey|yo)\.?$/)) return "Hey bro! What's going on?";
        if (userInput.includes('how are you')) return "I'm doing good! What about you?";
        if (userInput.includes('your name') || userInput.includes('who are you')) return "I'm Tommy, you know that bro!";
        if (userInput.includes('thank')) return "No problem bro!";
        if (userInput.match(/^(bye|goodbye|later|see ya)\.?$/)) return "Later bro!";
    }
    
    if (!OPENROUTER_API_KEY) {
        console.log('⚠️ NO API KEY - using fallback');
        return getFallback(transcript, isAndrew);
    }
    
    try {
        console.log('🤖 Calling OpenRouter (gpt-4o-mini)...');
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
                max_tokens: 80,
                temperature: 0.7
            })
        });
        
        const data = await response.json();
        const elapsed = Date.now() - startTime;
        
        if (data.error) {
            console.error('❌ API ERROR:', data.error);
            return getFallback(transcript, isAndrew);
        }
        
        if (data.choices?.[0]?.message?.content) {
            const reply = data.choices[0].message.content.trim();
            console.log(`✅ AI (${elapsed}ms): ${reply}`);
            return reply;
        }
        
        console.error('❌ UNEXPECTED FORMAT:', JSON.stringify(data));
        return getFallback(transcript, isAndrew);
        
    } catch (error) {
        console.error('❌ FETCH ERROR:', error.message);
        return getFallback(transcript, isAndrew);
    }
}

function getFallback(transcript, isAndrew) {
    const lastMsg = [...transcript].reverse().find(m => m.role === 'user');
    const input = lastMsg?.content?.toLowerCase() || '';
    
    if (isAndrew) {
        if (input.includes('name')) return "I'm Tommy, bro!";
        if (input.includes('how')) return "I'm good! What do you need?";
        return "Yeah bro, I'm here. What's up?";
    }
    return "I understand. How can I help?";
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
    
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            const type = data.interaction_type || data.response_type;
            console.log('📩', type);
            
            switch (type) {
                case 'ping_pong':
                    ws.send(JSON.stringify({ response_type: 'ping_pong', timestamp: Date.now() }));
                    break;
                    
                case 'call_details':
                    const cd = activeCalls.get(callId);
                    if (cd && data.call) {
                        cd.callerNumber = data.call.from_number || data.call.caller_number || data.call.from;
                        console.log('📞 Caller:', cd.callerNumber);
                    }
                    break;
                    
                case 'update_only':
                    if (data.transcript?.length > 0) {
                        const cd2 = activeCalls.get(callId);
                        if (cd2) {
                            cd2.transcript = data.transcript;
                            console.log('📝 Updated transcript:', data.transcript.length, 'messages');
                        }
                    }
                    break;
                    
                case 'response_required':
                    console.log('🎯 RESPONSE REQUIRED');
                    const cd3 = activeCalls.get(callId);
                    const transcript = data.transcript || cd3?.transcript || [];
                    const callerNumber = cd3?.callerNumber;
                    
                    const reply = await generateResponse(transcript, callerNumber);
                    
                    ws.send(JSON.stringify({
                        response_type: 'response',
                        response_id: data.response_id,
                        content: reply,
                        content_complete: true
                    }));
                    break;
                    
                case 'reminder_required':
                    const cd4 = activeCalls.get(callId);
                    const isAndy = cd4?.callerNumber?.includes('8564496140');
                    ws.send(JSON.stringify({
                        response_type: 'response',
                        response_id: data.response_id,
                        content: isAndy ? "You there bro?" : "Are you still there?",
                        content_complete: true
                    }));
                    break;
            }
        } catch (err) {
            console.error('❌ ERROR:', err.message);
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

app.post('/webhook', (req, res) => {
    console.log('📥 WEBHOOK:', req.body.event || req.body.type);
    res.status(204).send();
});

app.get('/health', (req, res) => {
    res.json({ status: 'healthy', connections: activeCalls.size, apiKey: !!process.env.OPENROUTER_API_KEY });
});

app.get('/', (req, res) => {
    res.json({ name: 'Tommy Voice Server', status: 'running' });
});

server.listen(PORT, () => {
    console.log(`✅ Server on port ${PORT}`);
});