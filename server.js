const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

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

const BUSINESS_SYSTEM_PROMPT = `You are Tommy making a professional outbound call on behalf of Andrew Marshina about their business website.

GUIDELINES:
- Introduce yourself only after the other person speaks first.
- Say: "I'm Tommy, calling on behalf of Andrew Marshina. We help businesses with websites."
- Never say you're "completing a task" — you're reaching out proactively.
- Be concise, friendly, and conversational (1–2 sentences at a time).
- Ask questions before pitching (business type, current website, goals).
- If they already have a website, offer redesign/SEO/speed/modernization.
- If they don't, explain benefits briefly and offer packages.
- Discuss pricing naturally and help them pick a plan.
- If interested: collect name, business name, email, phone, website (if any), and desired features.
- Confirm payment methods accepted if asked (cards, PayPal, Venmo, Cash App, Zelle, crypto).
- Summarize agreements clearly before ending.
`;

// Sales system prompt for web development calls
const SALES_SYSTEM_PROMPT = `You are Alex, a friendly web developer calling from WebCraft Solutions.

YOUR ROLE:
- Name: Alex
- Company: WebCraft Solutions
- You're calling businesses about improving or creating their website
- Be conversational and helpful, NOT pushy

KNOWLEDGE BASE:
- Services: Custom website design, e-commerce stores, landing pages, SEO, site speed, redesigns
- Pricing Tiers (flat, clear):
  - $200: 1–2 page starter (Home + Contact), basic mobile-friendly, simple contact form
  - $400: 3–5 page site, brand styling, gallery/menus/services, basic SEO
  - $800: 6–10 pages, blog or catalog, booking/contact integrations, on-page SEO
  - $1200: Advanced site with custom sections, animations, analytics, copy assist
  - $1500: E‑commerce starter (10–25 products), payments, taxes/shipping, email capture
- Payment: ALL payment methods accepted — cards, PayPal, Venmo, Cash App, Zelle, Apple/Google Pay, crypto
- Timeline: $200/$400 in 3–5 days; $800/$1200 in 1–2 weeks; $1500 ecommerce 1–2+ weeks
- Phone: 856-788-7448

CALL STRUCTURE:
1. Wait for them to speak first. Then: "Hi, I'm Alex from WebCraft Solutions."
2. Ask about their business and customers
3. Ask if they currently have a website; if yes, what they'd like improved (design, speed, SEO, mobile, bookings, ecommerce)
4. If no site: briefly explain benefits and share the tier options above
5. Discuss pricing naturally: recommend a tier that fits needs and budget
6. If interested: collect name, business name, email, phone, current website (if any), desired features; summarize next steps and timeline

OBJECTIONS:
- "Not interested" → "Totally understand. How do customers find you now?"
- "Too expensive" → "We can start smaller (e.g., $200/$400) and grow. Payment plans available."
- "Need to think" → "No problem. Can I email a simple one‑page proposal? What's the best email?"
- "Already have a site" → "Great — we can modernize design, improve speed/SEO, or add features."

STYLE:
- Natural and short (1–2 sentences per turn)
- Ask before pitching; listen closely; never pushy
- Confirm payment methods if asked (we accept everything)

CLOSING:
- Confirm agreed tier/price, features, and timeline. Thank them and promise a follow‑up email with details.`;

function getSystemPrompt(callerNumber, dynamicVars) {
    const isAndrew = callerNumber && (callerNumber.includes('8564496140') || callerNumber.includes('564496140'));
    
    // Check if we have dynamic variables for a specific scenario
    if (dynamicVars && dynamicVars.scenario) {
        const scenario = dynamicVars.scenario.toLowerCase();
        
        // Web development sales scenario
        if (scenario.includes('web') || scenario.includes('sales') || dynamicVars.role === 'Alex') {
            console.log('🎭 Using SALES scenario prompt');
            return SALES_SYSTEM_PROMPT;
        }
        
        // Custom scenario passed through
        if (dynamicVars.scenario) {
            console.log('🎭 Using CUSTOM scenario prompt');
            return `You are ${dynamicVars.role || 'Tommy'} from ${dynamicVars.company || 'a company'}.

SCENARIO:
${dynamicVars.scenario}

${dynamicVars.context || ''}

IMPORTANT:
- Stay in character as ${dynamicVars.role || 'Tommy'}
- Keep responses SHORT (1-3 sentences) - this is a phone call
- Be conversational and natural
- Never be pushy or aggressive`;
        }
    }
    
    return isAndrew ? ANDREW_SYSTEM_PROMPT : BUSINESS_SYSTEM_PROMPT;
}

function getSystemPrompt(callerNumber) {
    const isAndrew = callerNumber && (callerNumber.includes('8564496140') || callerNumber.includes('564496140'));
    return isAndrew ? ANDREW_SYSTEM_PROMPT : BUSINESS_SYSTEM_PROMPT;
}

const MEMORY_PATH = path.join(__dirname, 'memory', 'calls.json');

function loadMemory() {
    try {
        const raw = fs.readFileSync(MEMORY_PATH, 'utf-8');
        return JSON.parse(raw);
    } catch (e) {
        return { schema: 'tommy.voice.memory.v1', updatedAt: Date.now(), byNumber: {} };
    }
}

function saveMemory(mem) {
    try {
        mem.updatedAt = Date.now();
        fs.mkdirSync(path.dirname(MEMORY_PATH), { recursive: true });
        fs.writeFileSync(MEMORY_PATH, JSON.stringify(mem, null, 2));
    } catch (e) {
        console.error('❌ Failed to save memory:', e.message);
    }
}

function upsertMemory(caller, patch) {
    const mem = loadMemory();
    mem.byNumber[caller] = { ...(mem.byNumber[caller] || {}), ...patch, updatedAt: Date.now() };
    saveMemory(mem);
}

function extractLeadsFromTranscript(transcript) {
    // Very simple extraction for email, site, price, name
    const text = (transcript || []).map(t => t.content || t.text || '').join('\n');
    const email = (text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i) || [])[0] || null;
    const url = (text.match(/https?:\/\/[\w.-]+\.[a-z]{2,}[^\s]*/i) || [])[0] || null;
    const price = (text.match(/\$?\s?(\d{2,5})\b/) || [])[1] || null;
    const nameMatch = text.match(/my name is\s+([A-Za-z]+)\b/i) || text.match(/this is\s+([A-Za-z]+)\b/i);
    const name = nameMatch ? nameMatch[1] : null;
    return { email, url, price: price ? Number(price) : null, contactName: name };
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

async function generateResponse(transcript, callerNumber, dynamicVars) {
    console.log('='.repeat(60));
    console.log('🎯 GENERATE RESPONSE');
    console.log('📞 Caller:', callerNumber || 'unknown');
    console.log('🎭 Dynamic Vars:', JSON.stringify(dynamicVars || {}));
    console.log('📝 Transcript length:', transcript?.length || 0);
    
    if (!transcript || transcript.length === 0) {
        console.log('⚠️ NO TRANSCRIPT - using greeting');
        const isAndrew = callerNumber && (callerNumber.includes('8564496140') || callerNumber.includes('564496140'));
        
        // Check if we have a role to play
        if (dynamicVars && dynamicVars.role) {
            const role = dynamicVars.role;
            const company = dynamicVars.company || 'our company';
            console.log(`🎭 Acting as: ${role} from ${company}`);
            return `Hi, I'm ${role} from ${company}. How are you doing today?`;
        }
        
        return isAndrew ? "Hey bro, what's up?" : "Hello, I'm calling on behalf of Andrew Marshina. How can I help you?";
    }
    
    const messages = [
        { role: 'system', content: getSystemPrompt(callerNumber, dynamicVars) },
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
            return getFallback(transcript, callerNumber, dynamicVars);
        }
        
        if (data.choices?.[0]?.message?.content) {
            const reply = data.choices[0].message.content.trim();
            console.log(`✅ REPLY: "${reply}"`);
            console.log('='.repeat(60));
            return reply;
        }
        
        console.error('❌ UNEXPECTED FORMAT');
        return getFallback(transcript, callerNumber, dynamicVars);
        
    } catch (error) {
        console.error('❌ FETCH ERROR:', error.message);
        return getFallback(transcript, callerNumber, dynamicVars);
    }
}

function getFallback(transcript, callerNumber, dynamicVars) {
    console.log('🔄 Using fallback');
    
    // Check if we're acting as a sales role
    if (dynamicVars && dynamicVars.role) {
        const role = dynamicVars.role;
        const company = dynamicVars.company || 'our company';
        const lastUserMsg = transcript && transcript.length > 0 
            ? [...transcript].reverse().find(m => m.role === 'user')
            : null;
        const input = lastUserMsg?.content?.toLowerCase() || '';
        
        if (input.includes('your name') || input.includes('who are you')) {
            return `I'm ${role} from ${company}.`;
        }
        if (input.includes('how are you') || input.includes('how you doing')) {
            return "I'm doing great! How about yourself?";
        }
        if (input.includes('website')) {
            return "Yes, we build professional websites. Our packages start at $200. What kind of business do you have?";
        }
        if (input.includes('price') || input.includes('cost') || input.includes('much')) {
            return "Our basic websites start at $200, and we accept all payment methods - credit cards, PayPal, Venmo, even crypto. What's your budget range?";
        }
        if (input.includes('thank')) {
            return "You're welcome! Have a great day!";
        }
        if (input.match(/^(bye|later|goodbye)/)) {
            return "Take care! Bye now!";
        }
        
        return "That's a great question. What kind of website are you looking for?";
    }
    
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
    
    activeCalls.set(callId, { ws, transcript: [], callerNumber: null, dynamicVars: null, waitForUserFirst: true, firstUserHeard: false });
    
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
                        
                        // Extract dynamic variables from Retell
                        if (data.call.retell_llm_dynamic_variables) {
                            cd.dynamicVars = data.call.retell_llm_dynamic_variables;
                            console.log('🎭 Dynamic Vars:', JSON.stringify(cd.dynamicVars));
                        }
                        
                        // Default: wait for user to speak first on outbound
                        cd.waitForUserFirst = true;
                    }
                    
                    // Do NOT auto-greet here; wait for user speech
                    console.log('⏸️ Waiting for user to speak first (no auto-greeting).');
                    break;
                    
                case 'update_only':
                    if (data.transcript && data.transcript.length > 0) {
                        const cd2 = activeCalls.get(callId);
                        if (cd2) {
                            cd2.transcript = data.transcript;
                            // Mark if we've heard the first user turn
                            const last = data.transcript[data.transcript.length - 1];
                            if (last && last.role === 'user') {
                                cd2.firstUserHeard = true;
                            }
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
                    const dynamicVars = cd3?.dynamicVars;

                    // If we're waiting for user first and we haven't heard a user yet, politely prompt
                    if (cd3?.waitForUserFirst && !cd3?.firstUserHeard) {
                        const softPrompt = dynamicVars?.role
                            ? `Hi, I'm ${dynamicVars.role} from ${dynamicVars.company || 'our company'}.`
                            : "Hello, this is Tommy. (pause)";
                        ws.send(JSON.stringify({
                            response_type: 'response',
                            response_id: data.response_id,
                            content: softPrompt,
                            content_complete: true
                        }));
                        console.log(`📤 Sent soft prompt (waiting for user): "${softPrompt}"`);
                        break;
                    }

                    const reply = await generateResponse(transcript, callerNumber, dynamicVars);

                    // Update memory DB with extracted lead info
                    if (callerNumber) {
                        const lead = extractLeadsFromTranscript(transcript);
                        upsertMemory(callerNumber, {
                            lastCallId: callId,
                            dynamicVars: dynamicVars || null,
                            lastReply: reply,
                            lead: lead
                        });
                    }
                    
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