/**
 * Chat domain — extracted from index.mjs (Phase 2 modular refactor)
 * Exports: sendEmail, extractContactInfoWithLLM, extractTextFromPDF,
 *          extractTextFromDOCX, processAttachments, chatWithClaude, chatWithOpenAI
 */

import Anthropic from '@anthropic-ai/sdk';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';

import { ANTHROPIC_API_KEY, OPENAI_API_KEY, CLAUDE_MODEL, OPENAI_MODEL, SYSTEM_PROMPT, LLM_PRICING } from '../lib/config.mjs';
import { renderAdminNewApplication } from '../email-templates.mjs';
import { sendToAdmins } from '../email-service.mjs';

// Initialize Anthropic client (self-contained — index.mjs retains its own copy for non-chat uses)
const anthropic = new Anthropic({
  apiKey: ANTHROPIC_API_KEY,
});

// Send Email via AWS SES (new lead from chat)
export async function sendEmail(visitorInfo, messages, aiResponse, clientIP) {
  try {
    const { html, text, subject } = renderAdminNewApplication({
      name: visitorInfo.name || 'Not provided',
      email: visitorInfo.email || 'Not provided',
      company: visitorInfo.company || undefined,
      role: visitorInfo.role || undefined,
      message: `Page: ${visitorInfo.page || 'Unknown'} | IP: ${clientIP || 'Unknown'} | Time: ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} EST`,
      applicationId: undefined,
    });
    const result = await sendToAdmins(subject, html, text);
    console.log('Email sent successfully:', result.messageId || result.error);
    return result.success;
  } catch (error) {
    console.error('Email send error:', error.message);
    return false;
  }
}

export async function extractContactInfoWithLLM(messages) {
  const conversationText = messages
    .map(m => `${m.role}: ${m.content}`)
    .join('\n');

  const extractionPrompt = `Analyze this conversation and extract any contact information the user has provided.

CONVERSATION:
${conversationText}

Extract and return ONLY a JSON object with these fields (use null if not found):
- name: The person's full name (first name, or first and last name)
- email: Their email address
- phone: Their phone number (any format)

IMPORTANT:
- Look for names in phrases like "I'm John", "my name is Sarah", "This is Mike", or just a name by itself
- Names can be in any case (lowercase, uppercase, mixed)
- Return ONLY the JSON, no other text

Example response:
{"name": "John Smith", "email": "john@example.com", "phone": null}`;

  try {
    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 150,
      messages: [{ role: 'user', content: extractionPrompt }]
    });

    const text = response.content[0].text.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      console.log('LLM extracted contact info:', parsed);
      return {
        name: parsed.name || null,
        email: parsed.email?.toLowerCase() || null,
        phone: parsed.phone || null
      };
    }
  } catch (error) {
    console.error('LLM extraction error:', error.message);
  }

  return { name: null, email: null, phone: null };
}

// Extract text from PDF attachment
export async function extractTextFromPDF(base64Data) {
  try {
    // Remove data URL prefix if present
    const base64Content = base64Data.replace(/^data:[^;]+;base64,/, '');

    // Convert base64 to buffer
    const pdfBuffer = Buffer.from(base64Content, 'base64');

    // Parse PDF and extract text
    const pdfData = await pdfParse(pdfBuffer);

    console.log('PDF extracted:', {
      pages: pdfData.numpages,
      textLength: pdfData.text?.length || 0
    });

    // Clean up the extracted text
    let text = pdfData.text || '';

    // Remove excessive whitespace while preserving paragraph structure
    text = text
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+/g, ' ')
      .trim();

    // Limit text length to avoid token overflow (roughly 10k chars)
    if (text.length > 10000) {
      text = text.substring(0, 10000) + '\n\n[... PDF content truncated due to length ...]';
    }

    return {
      success: true,
      text: text,
      pages: pdfData.numpages,
      info: pdfData.info || {}
    };
  } catch (error) {
    console.error('PDF extraction error:', error.message);
    return {
      success: false,
      error: error.message,
      text: null
    };
  }
}

// Extract text from DOCX attachment
export async function extractTextFromDOCX(base64Data) {
  try {
    // Remove data URL prefix if present
    const base64Content = base64Data.replace(/^data:[^;]+;base64,/, '');

    // Convert base64 to buffer
    const docxBuffer = Buffer.from(base64Content, 'base64');

    // Parse DOCX and extract text
    const result = await mammoth.extractRawText({ buffer: docxBuffer });

    console.log('DOCX extracted:', {
      textLength: result.value?.length || 0,
      messages: result.messages
    });

    // Clean up the extracted text
    let text = result.value || '';

    // Remove excessive whitespace while preserving paragraph structure
    text = text
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+/g, ' ')
      .trim();

    // Limit text length to avoid token overflow (roughly 10k chars)
    if (text.length > 10000) {
      text = text.substring(0, 10000) + '\n\n[... Document content truncated due to length ...]';
    }

    return {
      success: true,
      text: text
    };
  } catch (error) {
    console.error('DOCX extraction error:', error.message);
    return {
      success: false,
      error: error.message,
      text: null
    };
  }
}

// Process attachments and extract content
export async function processAttachments(attachments) {
  if (!attachments || !Array.isArray(attachments) || attachments.length === 0) {
    return null;
  }

  const processedAttachments = [];

  for (const attachment of attachments) {
    const { name, type, dataUrl } = attachment;
    const data = dataUrl; // Frontend sends dataUrl, we use it as data

    console.log('Processing attachment:', { name, type, dataLength: data?.length || 0 });

    // Handle PDF files
    if (type === 'application/pdf' || name?.toLowerCase().endsWith('.pdf')) {
      const pdfResult = await extractTextFromPDF(data);
      if (pdfResult.success) {
        processedAttachments.push({
          type: 'pdf',
          name: name,
          content: pdfResult.text,
          pages: pdfResult.pages
        });
      } else {
        processedAttachments.push({
          type: 'pdf',
          name: name,
          error: pdfResult.error,
          content: `[Unable to extract text from PDF: ${pdfResult.error}]`
        });
      }
    }
    // Handle text files
    else if (type === 'text/plain' || name?.toLowerCase().endsWith('.txt')) {
      try {
        const textContent = Buffer.from(data.replace(/^data:[^;]+;base64,/, ''), 'base64').toString('utf-8');
        processedAttachments.push({
          type: 'text',
          name: name,
          content: textContent.substring(0, 10000) // Limit length
        });
      } catch (error) {
        processedAttachments.push({
          type: 'text',
          name: name,
          error: error.message,
          content: `[Unable to read text file: ${error.message}]`
        });
      }
    }
    // Handle Word documents (.docx with mammoth, .doc not fully supported)
    else if (type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
             name?.toLowerCase().endsWith('.docx')) {
      const docxResult = await extractTextFromDOCX(data);
      if (docxResult.success) {
        processedAttachments.push({
          type: 'docx',
          name: name,
          content: docxResult.text
        });
      } else {
        processedAttachments.push({
          type: 'docx',
          name: name,
          error: docxResult.error,
          content: `[Unable to extract text from DOCX: ${docxResult.error}]`
        });
      }
    }
    // Handle old .doc format (not fully supported)
    else if (type === 'application/msword' || name?.toLowerCase().endsWith('.doc')) {
      processedAttachments.push({
        type: 'doc',
        name: name,
        content: `[Old Word format (.doc) uploaded: ${name}. Please save as .docx or PDF for text extraction.]`
      });
    }
    // Images are handled separately via Claude's vision
    else if (type?.startsWith('image/')) {
      processedAttachments.push({
        type: 'image',
        name: name,
        isImage: true,
        data: data // Keep for vision API
      });
    }
    // Unknown file type
    else {
      processedAttachments.push({
        type: 'unknown',
        name: name,
        content: `[File uploaded: ${name}. File type not supported for text extraction.]`
      });
    }
  }

  return processedAttachments.length > 0 ? processedAttachments : null;
}

// Chat with Claude
export async function chatWithClaude(messages, hasContactInfo, screenshot = null, pageContext = null, processedAttachments = null) {
  try {
    let contextualPrompt = SYSTEM_PROMPT;

    // Add page context so AI knows where the user is
    if (pageContext && pageContext.currentPage) {
      contextualPrompt += `\n\n## CURRENT PAGE CONTEXT:
The user is currently viewing the "${pageContext.currentPage}" page on the AI Product Studio website.
Page URL: ${pageContext.url || 'Unknown'}
If the user asks about "this page" or "where am I", refer to this page context.`;
    }

    if (hasContactInfo) {
      contextualPrompt += '\n\n## Current Status: Contact info collected. Provide helpful detailed answers about AI Product Studio partnerships.';
    } else {
      contextualPrompt += '\n\n## Current Status: NO CONTACT INFO YET. You must ask for name and phone/email before giving detailed answers!';
    }

    // Build attachment context for the AI
    let attachmentContext = '';
    if (processedAttachments && processedAttachments.length > 0) {
      attachmentContext = '\n\n## ATTACHED FILES:\n';
      for (const att of processedAttachments) {
        if (att.type === 'pdf') {
          attachmentContext += `\n### PDF Document: ${att.name} (${att.pages} pages)\n`;
          attachmentContext += `---BEGIN PDF CONTENT---\n${att.content}\n---END PDF CONTENT---\n`;
        } else if (att.type === 'text') {
          attachmentContext += `\n### Text File: ${att.name}\n`;
          attachmentContext += `---BEGIN TEXT CONTENT---\n${att.content}\n---END TEXT CONTENT---\n`;
        } else if (att.type === 'docx') {
          attachmentContext += `\n### Word Document: ${att.name}\n`;
          attachmentContext += `---BEGIN DOCX CONTENT---\n${att.content}\n---END DOCX CONTENT---\n`;
        } else if (att.type === 'doc') {
          attachmentContext += `\n### ${att.content}\n`;
        } else if (att.type !== 'image') {
          attachmentContext += `\n### ${att.content}\n`;
        }
      }
      attachmentContext += '\nPlease analyze the attached content and respond to the user\'s question about it.';
    }

    // Build messages array, potentially with vision
    const apiMessages = messages.map((m, index) => {
      // If this is the last user message, handle screenshot and image attachments
      if (m.role === 'user' && index === messages.length - 1) {
        const contentParts = [];

        // Add screenshot if present
        if (screenshot) {
          const matches = screenshot.match(/^data:([^;]+);base64,(.+)$/);
          const mediaType = matches ? matches[1] : 'image/jpeg';
          const base64Data = matches ? matches[2] : screenshot;
          contentParts.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: base64Data
            }
          });
        }

        // Add image attachments if present
        if (processedAttachments) {
          for (const att of processedAttachments) {
            if (att.isImage && att.data) {
              const matches = att.data.match(/^data:([^;]+);base64,(.+)$/);
              const mediaType = matches ? matches[1] : 'image/jpeg';
              const base64Data = matches ? matches[2] : att.data;
              contentParts.push({
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mediaType,
                  data: base64Data
                }
              });
            }
          }
        }

        // Add message text (with attachment context appended)
        const messageText = attachmentContext
          ? `${m.content}\n\n[User attached files - see content above in system context]`
          : m.content;

        contentParts.push({
          type: 'text',
          text: messageText
        });

        // Only use content array if we have images
        if (contentParts.length > 1 || contentParts.some(p => p.type === 'image')) {
          return {
            role: m.role,
            content: contentParts
          };
        }

        return { role: m.role, content: messageText };
      }
      return { role: m.role, content: m.content };
    });

    // Add attachment context to system prompt
    const fullSystemPrompt = contextualPrompt + attachmentContext;

    const response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1000, // Increased for attachment analysis
      system: fullSystemPrompt,
      messages: apiMessages
    });

    // Calculate token usage and estimated cost
    const inputTokens = response.usage?.input_tokens || 0;
    const outputTokens = response.usage?.output_tokens || 0;
    const totalTokens = inputTokens + outputTokens;
    const inputCost = (inputTokens / 1000) * LLM_PRICING.claude.input;
    const outputCost = (outputTokens / 1000) * LLM_PRICING.claude.output;
    const estimatedCost = parseFloat((inputCost + outputCost).toFixed(4));

    return {
      content: response.content[0].text,
      provider: 'claude',
      usage: {
        inputTokens,
        outputTokens,
        totalTokens,
        estimatedCost
      }
    };
  } catch (error) {
    console.error('Claude API error:', error);
    throw error;
  }
}

// Chat with OpenAI (backup)
export async function chatWithOpenAI(messages, hasContactInfo, screenshot = null) {
  try {
    let contextualPrompt = SYSTEM_PROMPT;
    if (hasContactInfo) {
      contextualPrompt += '\n\n## Current Status: Contact info collected. Provide helpful detailed answers about AI Product Studio partnerships.';
    } else {
      contextualPrompt += '\n\n## Current Status: NO CONTACT INFO YET. You must ask for name and phone/email before giving detailed answers!';
    }

    // Build messages array, potentially with vision
    const apiMessages = [
      { role: 'system', content: contextualPrompt },
      ...messages.map((m, index) => {
        // If this is the last user message and we have a screenshot, include it
        if (screenshot && m.role === 'user' && index === messages.length - 1) {
          return {
            role: m.role,
            content: [
              {
                type: 'image_url',
                image_url: {
                  url: screenshot,
                  detail: 'low'
                }
              },
              {
                type: 'text',
                text: m.content
              }
            ]
          };
        }
        return { role: m.role, content: m.content };
      })
    ];

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: apiMessages,
        max_tokens: 500,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();

    // Calculate token usage and estimated cost
    const inputTokens = data.usage?.prompt_tokens || 0;
    const outputTokens = data.usage?.completion_tokens || 0;
    const totalTokens = data.usage?.total_tokens || 0;
    const inputCost = (inputTokens / 1000) * LLM_PRICING.openai.input;
    const outputCost = (outputTokens / 1000) * LLM_PRICING.openai.output;
    const estimatedCost = parseFloat((inputCost + outputCost).toFixed(4));

    return {
      content: data.choices[0].message.content,
      provider: 'openai',
      usage: {
        inputTokens,
        outputTokens,
        totalTokens,
        estimatedCost
      }
    };
  } catch (error) {
    console.error('OpenAI API error:', error);
    throw error;
  }
}
