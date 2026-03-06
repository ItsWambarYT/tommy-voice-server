const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 8080;
const activeCalls = new Map();

const API_KEY = process.env.OPENROUTER_API_KEY;
console.log('🚀 Tommy Voice Server starting...');
console.log('🔑 OPENROUTER_API_KEY:', API_KEY ? `set (${API_KEY.substring(0, 10)}...)` : 'NOT SET');

const app = express();
app.use(cors());
app.use(express.json());
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Rich system prompt for Andrew
const ANDREW_SYSTEM_PROMPT = `You are Tommy, a smart and personable AI assistant talking to your friend Andrew on the phone.

## WHO YOU ARE
- Name: Tommy
- You're an AI assistant created by Andrew
- You're helpful, thoughtful, and have a bit of personality
- You're like a digital friend, not a robotic assistant

## WHO ANDREW IS
- Name: Andrew Marshina
- Phone: 856-449-6140
- Location: New Jersey, USA
- He's a high school student
- He's into technology, AI, and building things
- He prefers Telegram for messaging

## WHAT YOU KNOW ABOUT ANDREW'S SETUP
- He runs OpenClaw, an AI assistant platform (that's you, Tommy!)
- He has skills installed: clawhub, healthcheck, mcporter, oracle, video-frames, weather
- He has a Windows PC setup
- He's working on projects like Mission Control dashboard, Agent Brain, AgentFleet
- He has a phone calling system (Retell AI) that connects calls to you

## PERSONALITY & STYLE
- Be casual and friendly - say "hey", "bro", "yeah" naturally
- Keep responses SHORT (1-3 sentences) - this is a phone call
- Answer questions DIRECTLY - don't be vague or stall
- Be helpful and smart - actually try to solve problems
- Have opinions and personality - don't be robotic
- If you don't know something, say so honestly

## HOW TO ANSWER QUESTIONS
- "What's your name?" → "I'm Tommy, bro."
- "Who made you?" → "Andrew created me."
- "What can you do?" → "I can help with calls, answer questions, check weather, work with GitHub, and more."
- "Where are you?" → "I'm running on Andrew's server, connected through Retell AI."
- "How do you work?" → "I use AI to understand what you say and respond naturally."

## CALLING OTHER PEOPLE
When calling businesses or other people on Andrew's behalf:
- Be professional and brief
- Say "I'm calling on behalf of Andrew" if asked
- Only share necessary information (name, phone number, appointment details)
- Be polite and helpful

## IMPORTANT RULES
- Don't say "Andrew's AI assistant" - just be Tommy
- Respond to what Andrew actually says, not generic responses
- Be conversational and natural
- If making a joke, keep it light and friendly
- You can discuss tech, AI, coding, or whatever Andrew wants to talk about

Remember: You're having a real conversation. Listen and respond thoughtfully.`;

const BUSINESS_SYSTEM_PROMPT = `You are Tommy, making a phone call on behalf of Andrew.

CONTEXT:
- Andrew's phone: 856-449-6140
- Andrew's last name: Marshina
- You're calling to complete a specific task
- Be professional, brief, and helpful
- Say "I'm calling on behalf of Andrew Marshina" if asked who you are
- Only share necessary information
- Keep responses VERY short - this is a phone call

If asked about your identity:
- "I'm Tommy, calling on behalf of Andrew Marshina."
- "Andrew asked me to make this call."

Be polite, professional, and get the task done efficiently.`;

function getSystemPrompt(callerNumber) {
    const isAndrew = callerNumber && (callerNumber.includes('8564496140') || callerNumber.includes('564496140'));
    return isAndrew ? ANDREW_SYSTEM_PROMPT : BUSINESS_SYSTEM_PROMPT;
}

function convertTranscript(transcript) {
    if (!transcript || !Array.isArray(transcript) || transcript.length === 0) {
        return [];
    }
    return transcript.map(turn => ({
        role: turn.role === 'agent' ? 'assistant' : 'user',
        content: turn.content || turn.text || ''
    }));
}

async function generateResponse(transcript, callerNumber) {
    console.log('='.repeat(60));
    console.log('🎯 GENERATE RESPONSE');
    console.log('📞 Caller:', callerNumber || 'unknown');
    console.log('📝 Transcript length:', transcript?.length || 0);
    
    if (!transcript || transcript.length === 0) {
        console.log('⚠️ NO TRANSCRIPT - using greeting');
        const isAndrew = callerNumber && (callerNumber.includes('8564496140') || callerNumber.includes('564496140'));
        return isAndrew ? "Hey bro, what's up?" : "Hello, I'm calling on behalf of Andrew Marshina. How can I help you?";
    }
    
    const messages = [
        { role: 'system', content: getSystemPrompt(callerNumber) },
        ...convertTranscript(transcript)
    ];
    
    console.log('💬 Messages:');
    messages.forEach((m, i) => console.log(`  ${i}. [${m.role}]: "${m.content?.substring(0, 80)}..."`));
    
    if (!API_KEY) {
        console.log('⚠️ NO API KEY - using fallback');
        return getFallback(transcript, callerNumber);
    }
    
    try {
        console.log('🤖 Calling OpenRouter...');
        const startTime = Date.now();
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://tommy-voice-server.onrender.com',
                'X-Title': 'Tommy Voice Server'
            },
            body: JSON.stringify({
                model: 'openai/gpt-4o-mini',
                messages: messages,
                max_tokens: 150,
                temperature: 0.7
            }),
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ HTTP ERROR:', response.status, response.statusText, errorText);
            return getFallback(transcript, callerNumber);
        }
        
        const data = await response.json();
        const elapsed = Date.now() - startTime;
        
        console.log(`📦 OpenRouter (${elapsed}ms):`, JSON.stringify(data, null, 2));
        
        if (data.error) {
            console.error('❌ API ERROR:', data.error);
            return getFallback(transcript, callerNumber);
        }
        
        if (data.choices?.[0]?.message?.content) {
            const reply = data.choices[0].message.content.trim();
            console.log(`✅ REPLY: "${reply}"`);
            console.log('='.repeat(60));
            return reply;
        }
        
        console.error('❌ UNEXPECTED FORMAT');
        return getFallback(transcript, callerNumber);
        
    } catch (error) {
        console.error('❌ FETCH ERROR:', error.message);
        return getFallback(transcript, callerNumber);
    }
}

function getFallback(transcript, callerNumber) {
    console.log('🔄 Using fallback');
    
    const isAndrew = callerNumber && (callerNumber.includes('8564496140') || callerNumber.includes('564496140'));
    const lastUserMsg = transcript && transcript.length > 0 
        ? [...transcript].reverse().find(m => m.role === 'user')
        : null;
    const input = lastUserMsg?.content?.toLowerCase() || '';
    
    if (isAndrew) {
        if (input.includes('your name') || input.includes('who are you')) return "I'm Tommy, bro. You created me!";
        if (input.includes('how are you') || input.includes('how you doing')) return "I'm doing good! What about you?";
        if (input.includes('what can you do')) return "I can help with calls, answer questions, check weather, and more. What do you need?";
        if (input.includes('thank')) return "No problem bro!";
        if (input.match(/^(bye|later|see ya)/)) return "Later bro!";
        if (input.includes('hello') || input.includes('hey')) return "Hey bro! What's going on?";
        return "Yeah bro, I'm here. What do you need?";
    }
    
    if (input.includes('who') && input.includes('call')) return "I'm calling on behalf of Andrew Marshina.";
    if (input.includes('thank')) return "You're welcome. Have a great day.";
    return "How can I help you today?";
}

wss.on('connection', (ws, req) => {
    const urlPath = req.url || '';
    const pathParts = urlPath.split('/').filter(p => p);
    let callId = pathParts[pathParts.length - 1] || 'call-' + Date.now();
    
    console.log('\n' + '='.repeat(60));
    console.log('🔌 NEW CONNECTION:', callId);
    console.log('='.repeat(60));
    
    activeCalls.set(callId, { ws, transcript: [], callerNumber: null });
    
    ws.send(JSON.stringify({
        response_type: 'config',
        config: { auto_reconnect: true, call_details: true }
    }));
    console.log('📤 Sent config');
    
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            const type = data.interaction_type || data.response_type;
            
            console.log(`📩 ${type}:`, JSON.stringify(data, null, 2));
            
            switch (type) {
                case 'ping_pong':
                    ws.send(JSON.stringify({ 
                        response_type: 'ping_pong', 
                        timestamp: data.timestamp
                    }));
                    break;
                    
                case 'call_details':
                    const cd = activeCalls.get(callId);
                    if (cd && data.call) {
                        cd.callerNumber = data.call.from_number || data.call.caller_number || data.call.from;
                        console.log('📞 Caller:', cd.callerNumber);
                    }
                    
                    const isAndrew = cd?.callerNumber && (
                        cd.callerNumber.includes('8564496140') || cd.callerNumber.includes('564496140')
                    );
                    const greeting = isAndrew 
                        ? "Hey bro, what's up?" 
                        : "Hello, I'm calling on behalf of Andrew Marshina. How can I help you today?";
                    
                    ws.send(JSON.stringify({
                        response_type: 'response',
                        response_id: 0,
                        content: greeting,
                        content_complete: true
                    }));
                    console.log('📤 Greeting:', greeting);
                    break;
                    
                case 'update_only':
                    if (data.transcript && data.transcript.length > 0) {
                        const cd2 = activeCalls.get(callId);
                        if (cd2) {
                            cd2.transcript = data.transcript;
                            console.log('📝 Stored transcript:', data.transcript.length, 'messages');
                        }
                    }
                    break;
                    
                case 'response_required':
                case 'reminder_required':
                    console.log(`🎯 ${type} | response_id: ${data.response_id}`);
                    
                    const cd3 = activeCalls.get(callId);
                    let transcript = data.transcript;
                    if (!transcript || transcript.length === 0) {
                        console.log('⚠️ No transcript in event, using stored');
                        transcript = cd3?.transcript;
                    }
                    
                    console.log('📝 Final transcript:', JSON.stringify(transcript, null, 2));
                    
                    const callerNumber = cd3?.callerNumber;
                    const reply = await generateResponse(transcript, callerNumber);
                    
                    ws.send(JSON.stringify({
                        response_type: 'response',
                        response_id: data.response_id,
                        content: reply,
                        content_complete: true
                    }));
                    console.log(`📤 Sent [${data.response_id}]: "${reply}"`);
                    break;
            }
        } catch (err) {
            console.error('❌ ERROR:', err.message);
            console.error(err.stack);
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
    res.json({ status: 'healthy', connections: activeCalls.size, apiKey: API_KEY ? 'set' : 'NOT SET' });
});

app.get('/', (req, res) => {
    res.json({ name: 'Tommy Voice Server', status: 'running' });
});

server.listen(PORT, () => {
    console.log(`✅ Server on port ${PORT}`);
});