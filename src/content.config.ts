import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const projects = defineCollection({
	loader: glob({ pattern: "**/*.md", base: "./src/content/projects" }),
	schema: z.object({
		title: z.string(),
		summary: z.string(),
		year: z.number(),
		role: z.string(),
		services: z.array(z.string()),
		duration: z.string(),
		team: z.string(),
		featured: z.boolean().default(false),
		order: z.number(),
		accent: z.string(),
	}),
});

export const collections = { projects };
