// Global fallback session ID if available
declare const MCP_RUN_SESSION_ID: string | undefined;

/**
 * Environment variables for the Cloudflare Worker
 */
export interface Env {
  SIGNED_URL: string; // Signed URL for triggering tasks
  PROFILE: string; // Task profile name
  TASK_NAME: string; // Name of the task to execute
  POLL_INTERVAL_MS: number; // Polling interval in milliseconds
  API_BASE_URL: string; // Base URL for API requests
  SESSION_ID: string; // Session ID for authentication
}

/**
 * Task run response interface
 */
interface TaskRunResponse {
  name: string;
  status: "pending" | "running" | "ready" | "error";
  results: Array<{
    msg: string;
    time?: number;
    level?: number;
    exchange?: {
      role: string;
      content: string | any;
    };
    lastMessage?: {
      role: string;
      content: string | any;
    };
  }>;
  created_at: string;
  modified_at: string;
}

/**
 * Extracts raw HTML content even without code fences
 * @param text The text that may contain HTML content
 * @returns The extracted HTML content, or null if no HTML or code fences found
 */
function extractRawHTMLContent(text: string): string | null {
  if (!text || typeof text !== "string") return null;

  // First check if there are any code fences - if so, use the code fence extractor instead
  if (text.includes("```html") || text.includes("```")) {
    return null; // Signal to use the code fence extractor instead
  }

  // Regular expression to match HTML content starting with <!DOCTYPE or <html
  // This is a less strict match than code fences but should work for most cases
  const doctypeMatch = /<!DOCTYPE\s+html[^>]*>([\s\S]*$)/i.exec(text);
  const htmlTagMatch = /<html[^>]*>([\s\S]*$)/i.exec(text);

  if (doctypeMatch) {
    console.log("Found raw HTML content starting with <!DOCTYPE>");

    // Try to find where the HTML content ends (if there's text after it)
    const fullHtml = doctypeMatch[0];
    const endHtmlMatch = /<\/html>/i.exec(fullHtml);

    if (endHtmlMatch) {
      // Get the full HTML content including end tag and everything in between
      const endPos = endHtmlMatch.index + 7; // "</html>".length = 7
      return fullHtml.substring(0, endPos);
    }

    // If no end tag found, return everything from <!DOCTYPE> onwards
    return fullHtml;
  } else if (htmlTagMatch) {
    console.log("Found raw HTML content starting with <html>");

    // Try to find where the HTML content ends (if there's text after it)
    const fullHtml = htmlTagMatch[0];
    const endHtmlMatch = /<\/html>/i.exec(fullHtml);

    if (endHtmlMatch) {
      // Get the full HTML content including end tag and everything in between
      const endPos = endHtmlMatch.index + 7; // "</html>".length = 7
      return fullHtml.substring(0, endPos);
    }

    // If no end tag found, return everything from <html> onwards
    return fullHtml;
  }

  return null; // No HTML content found
}

/**
 * Extracts code fence content from text
 * @param text The text that may contain code fences
 * @param preferredLanguage Optional preferred language to extract
 * @returns The content inside the code fence, or the original text if no fence found
 */
function extractCodeFenceContent(
  text: string,
  preferredLanguage: string | null = null,
): string {
  if (!text || typeof text !== "string") return String(text);

  // Regular expression to match code fences with optional language specification
  // Group 1: language (optional)
  // Group 2: the content inside the fence
  const codeFenceRegex = /```([a-zA-Z]*)?[\r\n]+([\s\S]*?)```/g;

  const matches = [...text.matchAll(codeFenceRegex)];

  // If no code fences found, return original text
  if (matches.length === 0) return text;

  // If preferred language is specified, try to find that first
  if (preferredLanguage) {
    const preferredMatch = matches.find((match) =>
      match[1]?.toLowerCase() === preferredLanguage.toLowerCase()
    );

    if (preferredMatch) {
      console.log(`Found preferred language code fence: ${preferredLanguage}`);
      return preferredMatch[2].trim();
    }
  }

  // Log what we found
  const languages = matches.map((match) => match[1] || "unspecified").join(
    ", ",
  );
  console.log(
    `Found ${matches.length} code fences with languages: ${languages}`,
  );

  // If no preferred language match (or none specified), return the first match content
  return matches[0][2].trim();
}

/**
 * Special handler for the array of objects with 'text' property format
 */
function extractContentFromSpecialFormats(response: any): string {
  try {
    // If it's already a string, process it for code fences or raw HTML
    if (typeof response === "string") {
      // First check for code fences
      if (response.includes("```")) {
        return extractCodeFenceContent(response, "html");
      }

      // Then check for raw HTML without code fences
      const htmlContent = extractRawHTMLContent(response);
      if (htmlContent) {
        return htmlContent;
      }

      // Otherwise return the original string
      return response;
    }

    // Handle array format - specifically the [{"text": "content"}] format
    if (Array.isArray(response)) {
      console.log("Handling array response with", response.length, "items");

      // Check if it's an array of objects with a 'text' property
      if (
        response.length > 0 && response[0] && typeof response[0] === "object" &&
        "text" in response[0]
      ) {
        console.log("Found text property in first array item");
        const textContent = response[0].text;

        // Check if the text contains code fences
        if (typeof textContent === "string" && textContent.includes("```")) {
          console.log("Found code fences in text property");
          return extractCodeFenceContent(textContent, "html");
        }

        // Check for raw HTML without code fences
        if (typeof textContent === "string") {
          const htmlContent = extractRawHTMLContent(textContent);
          if (htmlContent) {
            console.log("Found raw HTML in text property");
            return htmlContent;
          }
        }

        return String(textContent);
      }

      // If it's a simple array, join elements with newlines
      return response.map((item) => String(item)).join("\n");
    }

    // Handle object format
    if (response && typeof response === "object") {
      // Check if it has a text property
      if ("text" in response) {
        const textContent = response.text;

        // Check if the text contains code fences
        if (typeof textContent === "string" && textContent.includes("```")) {
          return extractCodeFenceContent(textContent, "html");
        }

        // Check for raw HTML without code fences
        if (typeof textContent === "string") {
          const htmlContent = extractRawHTMLContent(textContent);
          if (htmlContent) {
            console.log("Found raw HTML in text property");
            return htmlContent;
          }
        }

        return String(textContent);
      }

      // Otherwise serialize the object
      return JSON.stringify(response);
    }

    // Fallback
    return String(response);
  } catch (error) {
    console.error("Error extracting content from special format:", error);
    return String(response);
  }
}

/**
 * Extracts text content from task results
 */
function extractTextContent(taskData: TaskRunResponse | any): string {
  console.log("Extracting text from task data:", typeof taskData);
  try {
    // Check if taskData has the expected structure
    if (!taskData || typeof taskData !== "object") {
      console.warn("Task data is not an object:", taskData);
      return "";
    }

    if (
      !taskData.results || !Array.isArray(taskData.results) ||
      taskData.results.length === 0
    ) {
      console.warn(
        "Task data has no results array or empty results:",
        taskData.results
          ? `Array: ${
            Array.isArray(taskData.results)
          }, Length: ${taskData.results.length}`
          : "undefined",
      );
      return "";
    }

    // First check for a lastMessage in any result item
    const lastMessageResult = taskData.results.find((r) =>
      r?.lastMessage?.content !== undefined
    );

    if (lastMessageResult?.lastMessage?.content !== undefined) {
      console.log(
        "Found lastMessage content type:",
        typeof lastMessageResult.lastMessage.content,
      );

      // Apply our new special format handler to handle the case where content might be
      // an array containing objects with text property
      return extractContentFromSpecialFormats(
        lastMessageResult.lastMessage.content,
      );
    }

    // If no lastMessage, check for exchange content
    const exchangeResult = taskData.results.find((r) =>
      r?.exchange?.content !== undefined
    );

    if (exchangeResult?.exchange?.content !== undefined) {
      console.log(
        "Found exchange content type:",
        typeof exchangeResult.exchange.content,
      );

      // Apply our new special format handler
      return extractContentFromSpecialFormats(exchangeResult.exchange.content);
    }

    // As a fallback, use the last message text if available
    const lastResult = taskData.results[taskData.results.length - 1];
    if (lastResult?.msg !== undefined) {
      console.log("Using last message text type:", typeof lastResult.msg);

      // Apply our new special format handler
      return extractContentFromSpecialFormats(lastResult.msg);
    }

    console.warn("No usable content found in task results");
    return "";
  } catch (error) {
    console.error("Error extracting text content:", error);
    return "";
  }
}

/**
 * Main Cloudflare Worker
 */
export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    if (request.url.includes("favicon.ico")) {
      return new Response("");
    }

    // Only apply caching for GET requests
    if (request.method === "GET") {
      // Set up caching
      const cacheUrl = new URL(request.url);
      const cacheKey = new Request(cacheUrl.toString(), request);
      const cache = caches.default;

      // Check if we have a cached response
      let response = await cache.match(cacheKey);

      if (response) {
        console.log(`Cache hit for: ${request.url}`);
        return response;
      }

      console.log(`Cache miss for: ${request.url}. Running task...`);

      // No cache hit, continue with task execution
      try {
        const taskResponse = await executeTask(request, env);

        // Set cache control headers
        const headers = new Headers(taskResponse.headers);
        headers.append("Cache-Control", "s-maxage=3600"); // Cache for 1 hour

        // Create a new response with the same body and updated headers for caching
        const responseToCache = new Response(taskResponse.clone().body, {
          status: taskResponse.status,
          statusText: taskResponse.statusText,
          headers: headers,
        });

        // Store in cache (don't await this, let it happen in the background)
        ctx.waitUntil(cache.put(cacheKey, responseToCache));

        return taskResponse;
      } catch (error) {
        console.error("Error executing task:", error);
        return new Response(`Error executing task: ${error.message}`, {
          status: 500,
        });
      }
    } else {
      // Non-GET requests bypass the cache
      try {
        return await executeTask(request, env);
      } catch (error) {
        console.error("Error executing task:", error);
        return new Response(`Error executing task: ${error.message}`, {
          status: 500,
        });
      }
    }
  },
};

/**
 * Execute the task and process the response
 */
async function executeTask(request: Request, env: Env): Promise<Response> {
  // Extract configuration from env
  const signedUrl = env.SIGNED_URL;
  const profile = env.PROFILE;
  const taskName = env.TASK_NAME;
  const pollIntervalMs = env.POLL_INTERVAL_MS || 5000; // Default to 5 seconds if not provided

  // Extract request information
  const url = new URL(request.url);
  const route = url.pathname;
  const method = request.method;

  // Get geo information from the request (if available in Cloudflare Workers)
  const geo = request.cf?.colo || "SFO";

  // Parse query parameters
  const query = Object.fromEntries(url.searchParams.entries());

  // Parse request body (if any)
  let rawBody = "";
  let parsedBody = {};
  try {
    // Clone the request to read the body, as it can only be read once
    const clonedRequest = request.clone();
    rawBody = await clonedRequest.text();

    // Try to parse as JSON if possible
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      // If not valid JSON, leave as is
    }
  } catch (e) {
    console.warn("Error reading request body:", e);
  }

  // Construct the task parameters with the required format
  const taskParams = {
    route: route,
    method: method,
    geo: geo,
    body: rawBody,
    query: JSON.stringify(query),
  };

  console.log("Task parameters:", JSON.stringify(taskParams, null, 2));

  // Create a unique run ID based on timestamp and random string
  const runId = `run-${Date.now()}-${
    Math.random().toString(36).substring(2, 10)
  }`;

  // Trigger the task run
  const taskRunResult = await triggerTaskRun(signedUrl, taskParams, runId);

  // Start polling for task completion
  const apiBaseUrl = env.API_BASE_URL;
  if (!apiBaseUrl) {
    throw new Error("API_BASE_URL environment variable is required");
  }

  // Get the session ID for authentication
  const sessionId = env.SESSION_ID ||
    (typeof MCP_RUN_SESSION_ID !== "undefined" ? MCP_RUN_SESSION_ID : "");

  const taskResult = await pollTaskUntilComplete(
    profile,
    taskName,
    runId,
    pollIntervalMs,
    apiBaseUrl,
    sessionId,
  );

  // Extract just the text content from the task result using our helper function
  console.log(
    "Task result structure:",
    JSON.stringify(taskResult, null, 2).substring(0, 500) + "...",
  );

  let responseContent = extractTextContent(taskResult);
  console.log("Extracted response content type:", typeof responseContent);

  // Default content type is text/html, but we'll check if it should be something else
  let contentType = "text/html";

  // Check if this is from a code fence and set appropriate content type
  if (responseContent && typeof responseContent === "string") {
    // If the content appears to be JSON
    if (
      (responseContent.trim().startsWith("{") &&
        responseContent.trim().endsWith("}")) ||
      (responseContent.trim().startsWith("[") &&
        responseContent.trim().endsWith("]"))
    ) {
      try {
        // Verify it's valid JSON
        JSON.parse(responseContent);
        contentType = "application/json";
        console.log("Setting content type to application/json");
      } catch (e) {
        // Not valid JSON, keep the default
      }
    } // If the content appears to be HTML
    else if (
      responseContent.trim().startsWith("<!DOCTYPE") ||
      responseContent.trim().startsWith("<html") ||
      (responseContent.includes("<body") && responseContent.includes("</body>"))
    ) {
      contentType = "text/html";
      console.log("Setting content type to text/html");
    } // Plain text fallback
    else {
      contentType = "text/plain";
      console.log("Setting content type to text/plain");
    }
  }

  // If we couldn't find any text content, provide a fallback message
  if (
    responseContent === undefined || responseContent === null ||
    responseContent === ""
  ) {
    responseContent =
      "Task completed, but no text content was found in the response.";
  }

  // Check if responseContent might be a stringified JSON array with the special format
  if (
    typeof responseContent === "string" &&
    (responseContent.startsWith("[{") || responseContent.includes('"text"'))
  ) {
    try {
      const parsed = JSON.parse(responseContent);
      responseContent = extractContentFromSpecialFormats(parsed);
      console.log("Re-extracted content from stringified JSON");
    } catch (e) {
      // If parsing fails, keep the original content
      console.log("Failed to parse as JSON, keeping as is:", e);
    }
  }

  // Ensure responseContent is always a string
  if (typeof responseContent !== "string") {
    responseContent = JSON.stringify(responseContent);
  }

  // Log what we're returning (safely)
  try {
    console.log(
      "Returning text content from task result (first 100 chars):",
      responseContent.substring(0, 100) +
        (responseContent.length > 100 ? "..." : ""),
    );
  } catch (error) {
    console.error("Error logging response content:", error);
  }

  // Return just the text content
  return new Response(responseContent, {
    headers: { "Content-Type": contentType },
  });
}

/**
 * Triggers a task run using the signed URL
 */
async function triggerTaskRun(
  signedUrl: string,
  params: Record<string, unknown>,
  runId: string,
): Promise<any> {
  const response = await fetch(signedUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "run-id": runId,
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to trigger task: ${response.status} ${errorText}`);
  }

  return response.json();
}

/**
 * Polls the task status until it reaches a terminal state (ready or error)
 */
async function pollTaskUntilComplete(
  profile: string,
  taskName: string,
  runId: string,
  pollIntervalMs: number,
  apiBaseUrl: string,
  sessionId: string,
): Promise<TaskRunResponse> {
  let isComplete = false;
  let taskData: TaskRunResponse | null = null;

  console.log(`Starting to poll task ${taskName} with run ID ${runId}`);

  // Use the provided API base URL for all requests

  while (!isComplete) {
    // Get the current task status with absolute URL
    const pollUrl = `${apiBaseUrl}/api/runs/~/${profile}/${taskName}/${runId}`;
    console.log(`Polling URL: ${pollUrl}`);

    // Prepare headers with authentication
    const headers: HeadersInit = {};
    if (sessionId) {
      headers["Cookie"] = `sessionId=${sessionId}`;
      console.log("Using session ID for authentication");
    }

    const response = await fetch(pollUrl, { headers });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to get task status: ${response.status} ${errorText}`,
      );
    }

    taskData = await response.json() as TaskRunResponse;
    console.log(`Task status: ${taskData.status}`);

    // Check if the task has reached a terminal state
    if (taskData.status === "ready" || taskData.status === "error") {
      isComplete = true;

      // Log all results
      if (taskData.results) {
        taskData.results.forEach((result) => {
          console.log(`[${result.level || "INFO"}] ${result.msg}`);

          if (result.exchange) {
            console.log(
              `Exchange (${result.exchange.role}): ${
                typeof result.exchange.content === "object"
                  ? "[Complex Object]"
                  : result.exchange.content.substring(0, 100) + "..."
              }`,
            );
          }

          if (result.lastMessage) {
            console.log(
              `Last Message (${result.lastMessage.role}): ${
                typeof result.lastMessage.content === "object"
                  ? "[Complex Object]"
                  : result.lastMessage.content.substring(0, 100) + "..."
              }`,
            );
          }
        });
      }
    } else {
      // Wait before polling again
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }

  return taskData as TaskRunResponse;
}

/**
 * Helper function to run a task programmatically
 */
export async function runTask(
  signedUrl: string,
  profile: string,
  taskName: string,
  params: Record<string, unknown>,
  pollIntervalMs: number = 5000,
  apiBaseUrl: string,
  sessionId: string = "",
): Promise<TaskRunResponse> {
  const runId = `run-${Date.now()}-${
    Math.random().toString(36).substring(2, 10)
  }`;

  await triggerTaskRun(signedUrl, params, runId);
  return pollTaskUntilComplete(
    profile,
    taskName,
    runId,
    pollIntervalMs,
    apiBaseUrl,
    sessionId,
  );
}
