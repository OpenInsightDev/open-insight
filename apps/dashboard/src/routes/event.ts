import { createFileRoute } from "@tanstack/react-router";
import type { Exec } from "@open-insight/eval";

const handleEvents = async (events: ReadonlyArray<Exec.Event>) => {};

export const Route = createFileRoute("/event")({});
