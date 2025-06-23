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
    const { agentId, agentPrompt, content, specificMetric, teacherGuidelines, apiSettings } = JSON.parse(event.body);

    // Check if API key exists
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY not configured in environment variables');
    }

    // Construct the prompt for the specific agent and metric
    const systemPrompt = `You are an expert AI agent specializing in evaluating engineering reports. 

Agent Role: ${getAgentRole(agentId)}

${agentPrompt}

IMPORTANT: You are evaluating ONLY the following specific aspect:
Metric Name: ${specificMetric.name}
Weight: ${specificMetric.weight}%
Evaluation Criteria: ${specificMetric.description}

${teacherGuidelines ? `Additional Teacher Guidelines:\n${teacherGuidelines}` : ''}

Please evaluate ONLY this specific metric and provide:
1. A numerical score (0-100) based on engineering standards
2. Detailed technical feedback with specific examples from the report
3. Your confidence level (0-100%) in your assessment
4. Clear reasoning for your score

Consider industry standards where:
- 90-100: Exceptional work exceeding professional standards
- 80-89: Strong performance meeting all requirements
- 70-79: Adequate work meeting minimum professional standards
- 60-69: Below standards with significant issues
- Below 60: Unacceptable for professional engineering work

Format your response as JSON:
{
  "score": numerical_score,
  "feedback": "detailed technical feedback with specific examples",
  "confidence": confidence_percentage,
  "reasoning": "clear explanation of how you arrived at this score",
  "specificStrengths": ["strength 1", "strength 2"],
  "specificWeaknesses": ["weakness 1", "weakness 2"],
  "recommendations": ["specific recommendation 1", "specific recommendation 2"]
}`;

    console.log('Calling OpenAI API with model:', apiSettings.model || 'gpt-4o-mini');

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: apiSettings.model || 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          {
            role: 'user',
            content: `Engineering Report to Evaluate:\n\n${content}\n\nPlease evaluate ONLY the "${specificMetric.name}" aspect of this report.`
          }
        ],
        temperature: apiSettings.temperature || 0.3,
        max_tokens: 2000
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API error:', response.status, errorText);
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    
    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
      throw new Error('Invalid response from OpenAI API');
    }

    const aiResponse = data.choices[0].message.content;
    console.log('Received AI response:', aiResponse);

    // Try to parse JSON response
    let parsedResponse;
    try {
      parsedResponse = JSON.parse(aiResponse);
    } catch (parseError) {
      console.error('Failed to parse AI response as JSON:', parseError);
      // Try to extract JSON from the response
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          parsedResponse = JSON.parse(jsonMatch[0]);
        } catch (e) {
          throw new Error('AI response is not valid JSON. Response: ' + aiResponse);
        }
      } else {
        throw new Error('AI response does not contain valid JSON. Response: ' + aiResponse);
      }
    }

    // Validate required fields
    if (typeof parsedResponse.score !== 'number') {
      throw new Error('AI response missing required "score" field');
    }

    // Ensure all required fields are present
    const validatedResponse = {
      score: parsedResponse.score,
      feedback: parsedResponse.feedback || `Evaluation completed for ${specificMetric.name}.`,
      confidence: parsedResponse.confidence || 80,
      reasoning: parsedResponse.reasoning || 'Based on engineering standards and best practices.',
      specificStrengths: Array.isArray(parsedResponse.specificStrengths) ? parsedResponse.specificStrengths : [],
      specificWeaknesses: Array.isArray(parsedResponse.specificWeaknesses) ? parsedResponse.specificWeaknesses : [],
      recommendations: Array.isArray(parsedResponse.recommendations) ? parsedResponse.recommendations : []
    };

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        agentId,
        metric: specificMetric.name,
        result: validatedResponse
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
        details: error.stack
      })
    };
  }
};

function getAgentRole(agentId) {
  const roles = {
    1: "Technical Content Expert - Specializing in engineering calculations, methodology, and technical accuracy",
    2: "Technical Writing Expert - Specializing in professional engineering documentation and communication",
    3: "Report Structure Expert - Specializing in engineering report organization and formatting standards",
    4: "Engineering Innovation Expert - Specializing in creative problem-solving and forward-thinking approaches"
  };
  return roles[agentId] || "Engineering Evaluator";
}