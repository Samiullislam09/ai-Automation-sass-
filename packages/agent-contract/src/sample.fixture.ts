/** Shared test fixture (excluded from the build). */
export const sampleManifest = {
  id: "writer",
  name: "Mr. Writer",
  version: "1.2.0",
  description: "Researches the web and writes a full SEO article",
  actions: [
    {
      id: "write_article",
      phrases: ["article likho", "write a post about"],
      input: { topic: "string", keywords: "string[]", tone: "string?", words: "number?" },
      output: { markdown: "string", title: "string", meta: "object", sources: "string[]" },
      irreversible: false,
      estimated_seconds: 300,
      cost_units: 40,
      needs: ["keywords"],
      user_messages: { started: "Writing about {topic}", done: "Article ready: {title}" },
    },
  ],
  office: { room: "writer", ico: "✍️", color: "#b48bff" },
};
