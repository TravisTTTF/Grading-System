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

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { agentResults, metrics, teacherGuidelines } = JSON.parse(event.body);

    // Validate input
    if (!agentResults || !metrics) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          success: false, 
          error: 'Missing required parameters: agentResults or metrics' 
        })
      };
    }

    // Check if OpenAI API key is configured
    if (!process.env.OPENAI_API_KEY) {
      console.log('OpenAI API key not found, using fallback consensus');
      const fallbackConsensus = generateFallbackConsensus(agentResults, metrics);
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          consensus: fallbackConsensus
        })
      };
    }

    const systemPrompt = `You are a Consensus Moderator AI agent responsible for synthesizing evaluations from multiple expert agents to reach fair, balanced consensus scores.

Your responsibilities:
1. Analyze individual agent assessments for patterns, agreements, and disagreements
2. Identify potential biases, outliers, or inconsistencies in agent evaluations
3. Generate balanced consensus scores for each metric based on evidence and reasoning
4. Provide meta-feedback on the evaluation process quality
5. Flag areas that may need human review due to significant disagreements or concerns

Agent Evaluation Results:
${JSON.stringify(agentResults, null, 2)}

Evaluation Metrics:
${metrics.map(metric => `- ${metric.name} (${metric.weight}%): ${metric.description}`).join('\n')}

${teacherGuidelines ? `Teacher Guidelines:\n${teacherGuidelines}\n` : ''}

Analyze the agent results and provide your consensus assessment in this exact JSON format:
{
  "consensusScores": {
    "${metrics.map(m => `"${m.name.toLowerCase().replace(/ /g, '_')}": final_score`).join(',\n    ')}
  },
  "agreements": [
    "specific areas where agents strongly agree and why",
    "another area of agreement"
  ],
  "disagreements": [
    "specific areas where agents disagree significantly and the nature of disagreement",
    "another area of disagreement"
  ],
  "confidence": overall_confidence_percentage_0_to_100,
  "flagsForReview": [
    "specific areas needing human attention due to disagreements or concerns",
    "another flag if applicable"
  ],
  "metaFeedback": "overall assessment of evaluation quality, reliability, and any patterns observed",
  "methodology": "clear explanation of how you reached consensus scores and weighted different agent perspectives"
}

Be thorough, analytical, and focus on reaching fair consensus scores that reflect the best collective judgment of the agents.`;

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
            content: 'Please analyze the agent evaluation results and provide your consensus assessment following the specified JSON format.'
          }
        ],
        temperature: 0.2,
        max_tokens: 2500
      })
    });

    if (!response.ok) {
      console.error('OpenAI API error:', response.status);
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const aiResponse = data.choices[0].message.content;

    let parsedResponse;
    try {
      // Clean the response
      const cleanedResponse = aiResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      parsedResponse = JSON.parse(cleanedResponse);
    } catch (parseError) {
      console.error('Consensus JSON parsing failed, using fallback:', parseError);
      parsedResponse = generateFallbackConsensus(agentResults, metrics);
    }

    // Validate and normalize consensus response
    const normalizedConsensus = normalizeConsensusResponse(parsedResponse, agentResults, metrics);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        consensus: normalizedConsensus
      })
    };

  } catch (error) {
    console.error('Consensus error:', error);
    
    // Fallback to mathematical consensus
    try {
      const { agentResults, metrics } = JSON.parse(event.body);
      const fallbackConsensus = generateFallbackConsensus(agentResults, metrics);
      
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          consensus: fallbackConsensus,
          note: 'Generated using fallback consensus method due to API error'
        })
      };
    } catch (fallbackError) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          success: false,
          error: error.message
        })
      };
    }
  }
};

function generateFallbackConsensus(agentResults, metrics) {
  const consensusScores = {};
  const agreements = [];
  const disagreements = [];
  const flagsForReview = [];

  metrics.forEach(metric => {
    const metricName = metric.name.toLowerCase().replace(/ /g, '_');
    const scores = Object.values(agentResults)
      .map(result => {
        return result.scores[metricName] || 
               result.scores[metric.name] || 
               result.scores[metric.name.toLowerCase()] ||
               75; // Default score
      })
      .filter(score => typeof score === 'number');

    if (scores.length > 0) {
      // Calculate statistics
      const average = scores.reduce((sum, score) => sum + score, 0) / scores.length;
      const max = Math.max(...scores);
      const min = Math.min(...scores);
      const range = max - min;
      const median = calculateMedian(scores);
      
      // Use weighted average favoring median for outlier resistance
      const consensusScore = Math.round((average * 0.6) + (median * 0.4));
      consensusScores[metricName] = Math.min(100, Math.max(0, consensusScore));

      // Analyze agreement level
      if (range <= 5) {
        agreements.push(`Strong agreement on ${metric.name} (range: ${range} points, consensus: ${consensusScore}%)`);
      } else if (range <= 10) {
        agreements.push(`Moderate agreement on ${metric.name} (range: ${range} points, consensus: ${consensusScore}%)`);
      } else if (range <= 20) {
        disagreements.push(`Noticeable disagreement on ${metric.name} (range: ${range} points, scores: ${scores.join(', ')})`);
      } else {
        disagreements.push(`Significant disagreement on ${metric.name} (range: ${range} points, scores: ${scores.join(', ')})`);
        flagsForReview.push(`Large score variance in ${metric.name} requires human review`);
      }
    } else {
      // No valid scores found
      consensusScores[metricName] = 75;
      flagsForReview.push(`No valid scores found for ${metric.name}`);
    }
  });

  // Calculate overall confidence
  const confidenceFactors = {
    agreementRatio: agreements.length / (agreements.length + disagreements.length),
    flagCount: flagsForReview.length,
    dataQuality: Object.keys(agentResults).length >= 3 ? 1 : 0.8
  };

  const baseConfidence = 85;
  const confidenceAdjustment = 
    (confidenceFactors.agreementRatio - 0.5) * 20 - // Agreement impact
    (confidenceFactors.flagCount * 5) + // Flag penalty
    ((confidenceFactors.dataQuality - 1) * 10); // Data quality bonus/penalty

  const confidence = Math.min(98, Math.max(50, baseConfidence + confidenceAdjustment));

  return {
    consensusScores,
    agreements,
    disagreements,
    confidence: Math.round(confidence),
    flagsForReview,
    metaFeedback: `Consensus reached through statistical analysis. ${agreements.length} areas of agreement, ${disagreements.length} areas of disagreement. ${flagsForReview.length > 0 ? 'Some areas flagged for review.' : 'No major concerns identified.'}`,
    methodology: 'Weighted average of agent scores (60% mean, 40% median) with outlier detection and agreement analysis'
  };
}

function calculateMedian(numbers) {
  const sorted = [...numbers].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  } else {
    return sorted[middle];
  }
}

function normalizeConsensusResponse(response, agentResults, metrics) {
  // Ensure all required fields exist with proper structure
  const normalized = {
    consensusScores: {},
    agreements: Array.isArray(response.agreements) ? response.agreements : [],
    disagreements: Array.isArray(response.disagreements) ? response.disagreements : [],
    confidence: typeof response.confidence === 'number' ? 
               Math.min(100, Math.max(0, response.confidence)) : 75,
    flagsForReview: Array.isArray(response.flagsForReview) ? response.flagsForReview : [],
    metaFeedback: response.metaFeedback || 'Consensus analysis completed.',
    methodology: response.methodology || 'AI-based consensus analysis'
  };

  // Normalize consensus scores
  metrics.forEach(metric => {
    const metricKey = metric.name.toLowerCase().replace(/ /g, '_');
    let consensusScore = response.consensusScores?.[metricKey] || 
                        response.consensusScores?.[metric.name] ||
                        response.consensusScores?.[metric.name.toLowerCase()];

    if (typeof consensusScore !== 'number') {
      // Generate fallback score from agent results
      const agentScores = Object.values(agentResults)
        .map(result => result.scores[metricKey] || result.scores[metric.name] || 75)
        .filter(score => typeof score === 'number');
      
      consensusScore = agentScores.length > 0 ? 
        Math.round(agentScores.reduce((sum, score) => sum + score, 0) / agentScores.length) : 75;
    }

    normalized.consensusScores[metricKey] = Math.min(100, Math.max(0, Math.round(consensusScore)));
  });

  // Validate arrays have reasonable content
  if (normalized.agreements.length === 0) {
    normalized.agreements.push('General alignment observed among evaluators');
  }

  return normalized;
}
