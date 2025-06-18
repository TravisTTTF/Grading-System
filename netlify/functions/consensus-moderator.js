// netlify/functions/consensus-moderator.js
exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers };
  }

  try {
    const { agentResults, metrics, teacherGuidelines } = JSON.parse(event.body);

    const systemPrompt = `You are a Consensus Moderator AI agent responsible for synthesizing evaluations from multiple expert agents.

Your task is to:
1. Analyze individual agent assessments for agreements and disagreements
2. Identify potential biases or inconsistencies
3. Generate a balanced consensus score for each metric
4. Provide meta-feedback on the evaluation process
5. Flag areas that may need human review

Agent Results to Synthesize:
${JSON.stringify(agentResults, null, 2)}

Evaluation Metrics:
${metrics.map(metric => `- ${metric.name} (${metric.weight}%): ${metric.description}`).join('\n')}

Teacher Guidelines:
${teacherGuidelines}

Provide your consensus analysis in JSON format:
{
  "consensusScores": {
    "metric1": final_score,
    "metric2": final_score,
    ...
  },
  "agreements": [
    "areas where agents strongly agree",
    ...
  ],
  "disagreements": [
    "areas where agents disagree significantly",
    ...
  ],
  "confidence": overall_confidence_percentage,
  "flagsForReview": [
    "specific areas needing human attention",
    ...
  ],
  "metaFeedback": "overall assessment of the evaluation quality and reliability",
  "methodology": "explanation of how consensus was reached"
}`;

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
            content: 'Please analyze the agent results and provide your consensus assessment.'
          }
        ],
        temperature: 0.2,
        max_tokens: 2500
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const aiResponse = data.choices[0].message.content;

    let parsedResponse;
    try {
      parsedResponse = JSON.parse(aiResponse);
    } catch (parseError) {
      // Fallback consensus calculation
      parsedResponse = generateFallbackConsensus(agentResults, metrics);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        consensus: parsedResponse
      })
    };

  } catch (error) {
    console.error('Consensus error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};

function generateFallbackConsensus(agentResults, metrics) {
  const consensusScores = {};
  const agreements = [];
  const disagreements = [];

  metrics.forEach(metric => {
    const metricName = metric.name.toLowerCase();
    const scores = Object.values(agentResults)
      .map(result => result.scores[metricName])
      .filter(score => score !== undefined);

    if (scores.length > 0) {
      const average = scores.reduce((sum, score) => sum + score, 0) / scores.length;
      const max = Math.max(...scores);
      const min = Math.min(...scores);
      const range = max - min;

      consensusScores[metricName] = Math.round(average);

      if (range <= 5) {
        agreements.push(`Strong agreement on ${metric.name} (range: ${range} points)`);
      } else if (range <= 10) {
        agreements.push(`Moderate agreement on ${metric.name} (range: ${range} points)`);
      } else {
        disagreements.push(`Significant disagreement on ${metric.name} (range: ${range} points)`);
      }
    }
  });

  return {
    consensusScores,
    agreements,
    disagreements,
    confidence: disagreements.length === 0 ? 95 : Math.max(60, 90 - disagreements.length * 8),
    flagsForReview: disagreements.length > 2 ? ['Multiple significant disagreements detected'] : [],
    metaFeedback: `Consensus reached with ${agreements.length} agreements and ${disagreements.length} disagreements.`,
    methodology: 'Weighted average with range analysis for agreement assessment'
  };
}
