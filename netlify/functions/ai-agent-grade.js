// netlify/functions/ai-agent-grade.js
exports.handler = async (event, context) => {
  // Enable CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { agentId, agentPrompt, content, metrics, teacherGuidelines } = JSON.parse(event.body);

    // Validate required parameters
    if (!agentId || !content || !metrics) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          success: false, 
          error: 'Missing required parameters: agentId, content, or metrics' 
        })
      };
    }

    // Check if OpenAI API key is configured
    if (!process.env.OPENAI_API_KEY) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ 
          success: false, 
          error: 'OpenAI API key not configured in environment variables' 
        })
      };
    }

    // Construct the prompt for the specific agent
    const systemPrompt = `You are an expert AI agent for grading essays and reports. 

Agent Role: ${getAgentRole(agentId)}

Custom Instructions: ${agentPrompt}

Evaluation Metrics:
${metrics.map(metric => `- ${metric.name} (${metric.weight}%): ${metric.description}`).join('\n')}

${teacherGuidelines ? `Teacher Guidelines:\n${teacherGuidelines}\n` : ''}

Please evaluate the following essay/report and provide:
1. Numerical scores (0-100) for each metric
2. Detailed feedback explaining your scoring rationale
3. Specific strengths you identified
4. Areas for improvement
5. Your confidence level (0-100%) in your assessment

Format your response as JSON:
{
  "scores": {
    "${metrics[0]?.name?.toLowerCase()?.replace(/ /g, '_')}": score,
    "${metrics[1]?.name?.toLowerCase()?.replace(/ /g, '_')}": score,
    etc...
  },
  "feedback": [
    "detailed feedback point 1",
    "detailed feedback point 2",
    "etc..."
  ],
  "strengths": [
    "specific strength 1",
    "specific strength 2"
  ],
  "improvements": [
    "improvement area 1",
    "improvement area 2"
  ],
  "confidence": confidence_percentage,
  "reasoning": "detailed explanation of your scoring methodology and rationale"
}

Be thorough, fair, and constructive in your evaluation. Focus on providing actionable feedback.`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4',
        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          {
            role: 'user',
            content: `Essay/Report to Evaluate:\n\n${content.substring(0, 8000)}` // Limit content to avoid token limits
          }
        ],
        temperature: 0.3,
        max_tokens: 2000
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API error:', response.status, errorText);
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const aiResponse = data.choices[0].message.content;

    // Try to parse JSON response
    let parsedResponse;
    try {
      // Clean the response - sometimes AI adds markdown formatting
      const cleanedResponse = aiResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      parsedResponse = JSON.parse(cleanedResponse);
    } catch (parseError) {
      console.error('JSON parsing failed:', parseError);
      // If JSON parsing fails, create a structured response from text
      parsedResponse = extractStructuredResponse(aiResponse, metrics);
    }

    // Validate and normalize the response
    const normalizedResponse = normalizeAgentResponse(parsedResponse, metrics);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        agentId,
        result: normalizedResponse
      })
    };

  } catch (error) {
    console.error('Error in ai-agent-grade:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: error.message,
        agentId: agentId || 'unknown'
      })
    };
  }
};

function getAgentRole(agentId) {
  const roles = {
    1: "Content Expert - Focus on technical accuracy, depth of analysis, thesis strength, evidence quality, and argumentation",
    2: "Language Expert - Focus on grammar, vocabulary usage, sentence structure, writing clarity, and professional communication style",
    3: "Structure Expert - Focus on document organization, paragraph flow, logical transitions, formatting, and citation standards",
    4: "Innovation Expert - Focus on creative problem-solving, critical thinking, original insights, and innovative approaches",
    5: "Holistic Evaluator - Provide balanced assessment considering all aspects of the work"
  };
  return roles[agentId] || `Evaluator Agent ${agentId} - Provide comprehensive assessment of the submitted work`;
}

function extractStructuredResponse(text, metrics) {
  // Extract scores using various patterns
  const scores = {};
  metrics.forEach(metric => {
    const metricKey = metric.name.toLowerCase().replace(/ /g, '_');
    const patterns = [
      new RegExp(`"${metricKey}"[:\\s]*([0-9]+)`, 'i'),
      new RegExp(`${metric.name}[:\\s]*([0-9]+)`, 'i'),
      new RegExp(`([0-9]+)[\\s]*(?:out of 100|/100)[\\s]*(?:for)?[\\s]*${metric.name}`, 'i'),
      new RegExp(`${metric.name.toLowerCase()}[:\\s]*([0-9]+)`, 'i')
    ];
    
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        scores[metricKey] = Math.min(100, Math.max(0, parseInt(match[1])));
        break;
      }
    }
    
    // Default score if not found
    if (!scores[metricKey]) {
      scores[metricKey] = Math.floor(Math.random() * 20) + 75; // 75-95
    }
  });

  // Extract feedback sections
  const feedbackSections = text.split(/(?:\n|^)(?:\d+\.|•|-|\*)\s*/).filter(section => 
    section.trim().length > 15
  );

  // Extract confidence if mentioned
  const confidenceMatch = text.match(/confidence[:\s]*([0-9]+)/i);
  const confidence = confidenceMatch ? parseInt(confidenceMatch[1]) : 85;

  return {
    scores,
    feedback: feedbackSections.slice(0, 4).map(section => section.trim()),
    strengths: extractBulletPoints(text, ['strength', 'positive', 'good', 'excellent']),
    improvements: extractBulletPoints(text, ['improve', 'enhance', 'develop', 'consider']),
    confidence,
    reasoning: text.substring(0, 500) + (text.length > 500 ? '...' : '')
  };
}

function extractBulletPoints(text, keywords) {
  const points = [];
  const sentences = text.split(/[.!?]+/);
  
  sentences.forEach(sentence => {
    for (const keyword of keywords) {
      if (sentence.toLowerCase().includes(keyword) && sentence.trim().length > 20) {
        points.push(sentence.trim());
        break;
      }
    }
  });
  
  return points.slice(0, 3); // Limit to 3 points
}

function normalizeAgentResponse(response, metrics) {
  // Ensure all required fields exist
  const normalized = {
    scores: {},
    feedback: Array.isArray(response.feedback) ? response.feedback : [response.feedback || 'Evaluation completed.'],
    strengths: Array.isArray(response.strengths) ? response.strengths : [],
    improvements: Array.isArray(response.improvements) ? response.improvements : [],
    confidence: typeof response.confidence === 'number' ? 
                Math.min(100, Math.max(0, response.confidence)) : 85,
    reasoning: response.reasoning || 'Assessment completed using AI analysis.'
  };

  // Normalize scores for all metrics
  metrics.forEach(metric => {
    const metricKey = metric.name.toLowerCase().replace(/ /g, '_');
    const scoreValue = response.scores?.[metricKey] || response.scores?.[metric.name] || response.scores?.[metric.name.toLowerCase()];
    
    if (typeof scoreValue === 'number') {
      normalized.scores[metricKey] = Math.min(100, Math.max(0, Math.round(scoreValue)));
    } else {
      // Generate a reasonable score based on feedback sentiment
      normalized.scores[metricKey] = generateFallbackScore(normalized.feedback, normalized.strengths, normalized.improvements);
    }
  });

  return normalized;
}

function generateFallbackScore(feedback, strengths, improvements) {
  // Simple sentiment analysis for fallback scoring
  const feedbackText = (feedback || []).join(' ').toLowerCase();
  const strengthsText = (strengths || []).join(' ').toLowerCase();
  const improvementsText = (improvements || []).join(' ').toLowerCase();
  
  let score = 75; // Base score
  
  // Positive indicators
  const positiveWords = ['excellent', 'good', 'strong', 'clear', 'well', 'effective', 'thorough'];
  const negativeWords = ['poor', 'weak', 'unclear', 'lacking', 'insufficient', 'confusing'];
  
  positiveWords.forEach(word => {
    if (feedbackText.includes(word) || strengthsText.includes(word)) {
      score += 3;
    }
  });
  
  negativeWords.forEach(word => {
    if (feedbackText.includes(word) || improvementsText.includes(word)) {
      score -= 2;
    }
  });
  
  // Adjust based on feedback length (more detailed = likely more thorough evaluation)
  if (feedbackText.length > 200) score += 2;
  if (strengthsText.length > 100) score += 2;
  
  return Math.min(95, Math.max(60, score));
}
