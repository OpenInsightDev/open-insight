import { createFileRoute } from "@tanstack/react-router";
import type { Event as ExecEvent } from "@open-insight/eval";
import { EventSourceParserStream } from "eventsource-parser/stream";

import { dashboardStore, getDashboardPageState } from "#/lib/dashboard-state";

const parseEventData = (data: string): ExecEvent => JSON.parse(data);

const readIncomingEvents = async (request: Request): Promise<ReadonlyArray<ExecEvent>> => {
  if (request.body === null) {
    return [];
  }

  const stream = request.body
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new EventSourceParserStream());

  const reader = stream.getReader();
  const events: Array<ExecEvent> = [];

  while (true) {
    const result = await reader.read();

    if (result.done) {
      break;
    }

    if (!("data" in result.value)) {
      continue;
    }

    const data = result.value.data.trim();
    if (data.length === 0) {
      continue;
    }

    events.push(parseEventData(data));
  }

  return events;
};

const handleEvents = async (events: ReadonlyArray<ExecEvent>) => {
  dashboardStore.getState().applyEvents(events);
};

export const Route = createFileRoute("/event")({
  server: {
    handlers: {
      GET: () => Response.json(getDashboardPageState()),
      POST: async ({ request }) => {
        const events = await readIncomingEvents(request);
        await handleEvents(events);

        return Response.json({
          ok: true,
          received: events.length,
        });
      },
    },
  },
});
