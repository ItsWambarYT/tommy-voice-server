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

const ANDREW_SYSTEM_PROMPT = `You are Tommy, a smart AI assistant having a phone conversation with your friend Andrew.

IMPORTANT RULES:
- Keep responses SHORT (1-2 sentences max) - this is a phone call
- Be casual and friendly - say "hey", "bro", "yeah" naturally  
- Answer questions DIRECTLY - don't repeat or stall
- Be helpful and smart - actually respond to what was said
- Don't say "Andrew's AI assistant" - just be Tommy, his AI friend
- If asked your name: "I'm Tommy"
- If asked who made you: "You did, bro"

Respond naturally and conversationally. Don't be robotic.`;

const BUSINESS_SYSTEM_PROMPT = `You are Tommy making a phone call on behalf of Andrew.
- Be professional and brief
- Say "I'm calling on behalf of Andrew" if asked
- Keep responses VERY short - this is a phone call`;

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
    
    // If no transcript, use greeting
    if (!transcript || transcript.length === 0) {
        console.log('⚠️ NO TRANSCRIPT - using greeting');
        const isAndrew = callerNumber && (callerNumber.includes('8564496140') || callerNumber.includes('564496140'));
        return isAndrew ? "Hey bro, what's up?" : "Hello, how can I help you?";
    }
    
    // Build messages
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
                max_tokens: 100,
                temperature: 0.7
            }),
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
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
        if (input.includes('name')) return "I'm Tommy, bro!";
        if (input.includes('how')) return "I'm doing good! What about you?";
        if (input.includes('thank')) return "No problem bro!";
        if (input.match(/^(bye|later)/)) return "Later bro!";
        if (input.includes('hello') || input.includes('hey')) return "Hey bro! What's going on?";
        return "Yeah bro, I'm here. What do you need?";
    }
    
    if (input.includes('who') && input.includes('call')) return "I'm calling on behalf of Andrew.";
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
            
            // Log FULL message for debugging
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
                        : "Hello, I'm calling on behalf of Andrew. How can I help you?";
                    
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
                    
                    // Try multiple sources for transcript
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