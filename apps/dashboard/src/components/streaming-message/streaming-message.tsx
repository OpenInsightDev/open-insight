import * as React from "react";
import {
  BrainIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  Clock3Icon,
  FileTextIcon,
  LinkIcon,
  LoaderCircleIcon,
  MessageSquareTextIcon,
  ShieldQuestionIcon,
  WrenchIcon,
} from "lucide-react";

import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import {
  Message,
  MessageContent,
  MessageFooter,
  MessageGroup,
  MessageHeader,
} from "@/components/ui/message.tsx";
import { cn } from "@/lib/utils.ts";

import {
  buildStreamingMessageSegments,
  formatStreamingValue,
  summarizeStreamingSegment,
  type StreamingMessagePart,
  type StreamingMessagePartInput,
  type StreamingKnownMessagePart,
  type StreamingMessageSegment,
  type StreamingSegmentStatus,
} from "./stream-parts.ts";

type StreamingMessageStreamProps = React.ComponentProps<"div"> & {
  parts: ReadonlyArray<StreamingMessagePartInput>;
  emptyLabel?: string;
  footer?: React.ReactNode;
};

const statusLabel = (status: StreamingSegmentStatus): string => {
  switch (status) {
    case "streaming":
      return "Streaming";
    case "complete":
      return "Complete";
    case "ready":
      return "Ready";
    case "preliminary":
      return "Preliminary";
    case "approval-required":
      return "Approval";
    case "failed":
      return "Failed";
  }
};

function StreamingStatusIcon({ status }: { status: StreamingSegmentStatus }) {
  if (status === "streaming") {
    return <LoaderCircleIcon className="streaming-message-spin" />;
  }

  if (status === "failed") {
    return <CircleAlertIcon />;
  }

  if (status === "approval-required") {
    return <ShieldQuestionIcon />;
  }

  if (status === "preliminary") {
    return <Clock3Icon />;
  }

  return <CheckCircle2Icon />;
}

function StreamingSegmentIcon({ segment }: { segment: StreamingMessageSegment }) {
  switch (segment.kind) {
    case "text":
      return <MessageSquareTextIcon />;
    case "reasoning":
      return <BrainIcon />;
    case "tool":
      return <WrenchIcon />;
    case "attachment":
      return <FileTextIcon />;
    case "source":
      return segment.sourceType === "url" ? <LinkIcon /> : <FileTextIcon />;
    case "error":
      return <CircleAlertIcon />;
  }
}

const segmentTitle = (segment: StreamingMessageSegment): string => {
  switch (segment.kind) {
    case "text":
      return "Output";
    case "reasoning":
      return "Reasoning";
    case "tool":
      return segment.name.length > 0 ? segment.name : "Tool call";
    case "attachment":
      return "File";
    case "source":
      return segment.sourceType === "url" ? "URL source" : "Document source";
    case "error":
      return "Error";
  }
};

const segmentStatus = (segment: StreamingMessageSegment): StreamingSegmentStatus => {
  switch (segment.kind) {
    case "text":
    case "reasoning":
    case "tool":
      return segment.status;
    case "error":
      return "failed";
    default:
      return "complete";
  }
};

const partCountLabel = (segment: StreamingMessageSegment): string =>
  `${segment.partIndexes.length} part${segment.partIndexes.length === 1 ? "" : "s"}`;

function StreamingSegmentHeader({ segment }: { segment: StreamingMessageSegment }) {
  const status = segmentStatus(segment);

  return (
    <MessageHeader className="streaming-message-header">
      <span className="streaming-message-title">
        <StreamingSegmentIcon segment={segment} />
        {segmentTitle(segment)}
      </span>
      <span className="streaming-message-header-meta">
        <Badge variant={status === "failed" ? "destructive" : "outline"}>
          <StreamingStatusIcon status={status} />
          {statusLabel(status)}
        </Badge>
        <span>{partCountLabel(segment)}</span>
      </span>
    </MessageHeader>
  );
}

function StreamingTextBody({
  segment,
}: {
  segment: Extract<StreamingMessageSegment, { kind: "text" | "reasoning" }>;
}) {
  const isEmpty = segment.text.length === 0;

  return (
    <div
      data-slot="streaming-message-text"
      data-kind={segment.kind}
      data-state={segment.status}
      className={cn("streaming-message-text", isEmpty && "is-empty")}
    >
      {isEmpty ? "Waiting for stream delta" : segment.text}
      {segment.status === "streaming" ? <span className="streaming-message-cursor" /> : null}
    </div>
  );
}

function StreamingJsonBlock({ value, label }: { value: unknown; label: string }) {
  return (
    <div className="streaming-message-json-group">
      <span>{label}</span>
      <pre>{formatStreamingValue(value)}</pre>
    </div>
  );
}

function StreamingToolBody({
  segment,
}: {
  segment: Extract<StreamingMessageSegment, { kind: "tool" }>;
}) {
  const hasParamsText = segment.paramsText.length > 0;
  const hasStructuredParams = segment.params !== undefined;
  const hasResult = segment.result !== undefined;

  return (
    <div className="streaming-message-tool">
      <div className="streaming-message-tool-meta">
        <span>{segment.providerExecuted ? "Provider executed" : "Framework executed"}</span>
        <span>{segment.id}</span>
      </div>
      {segment.approvalId === undefined ? null : (
        <div className="streaming-message-approval">
          Approval required: <code>{segment.approvalId}</code>
        </div>
      )}
      {hasParamsText ? (
        <StreamingJsonBlock label="Streaming params" value={segment.paramsText} />
      ) : null}
      {hasStructuredParams ? <StreamingJsonBlock label="Params" value={segment.params} /> : null}
      {hasResult ? (
        <StreamingJsonBlock
          label={segment.isFailure ? "Failure" : "Result"}
          value={segment.result}
        />
      ) : null}
      {!hasParamsText && !hasStructuredParams && !hasResult ? (
        <p className="streaming-message-placeholder">Waiting for tool parameters</p>
      ) : null}
    </div>
  );
}

function StreamingAttachmentBody({
  segment,
}: {
  segment: Extract<StreamingMessageSegment, { kind: "attachment" }>;
}) {
  return (
    <AttachmentGroup className="streaming-message-attachment-group">
      <Attachment size="sm" state="done">
        <AttachmentMedia>
          <FileTextIcon />
        </AttachmentMedia>
        <AttachmentContent>
          <AttachmentTitle>{segment.mediaType}</AttachmentTitle>
          <AttachmentDescription>{segment.byteLength} bytes</AttachmentDescription>
        </AttachmentContent>
      </Attachment>
    </AttachmentGroup>
  );
}

function StreamingSourceBody({
  segment,
}: {
  segment: Extract<StreamingMessageSegment, { kind: "source" }>;
}) {
  const description =
    segment.sourceType === "url"
      ? segment.url
      : `${segment.mediaType}${segment.fileName === undefined ? "" : ` · ${segment.fileName}`}`;

  return (
    <AttachmentGroup className="streaming-message-attachment-group">
      <Attachment size="sm" state="done">
        <AttachmentMedia>
          {segment.sourceType === "url" ? <LinkIcon /> : <FileTextIcon />}
        </AttachmentMedia>
        <AttachmentContent>
          <AttachmentTitle>{segment.title}</AttachmentTitle>
          <AttachmentDescription>{description}</AttachmentDescription>
        </AttachmentContent>
      </Attachment>
    </AttachmentGroup>
  );
}

function StreamingErrorBody({
  segment,
}: {
  segment: Extract<StreamingMessageSegment, { kind: "error" }>;
}) {
  return <pre className="streaming-message-error">{formatStreamingValue(segment.error)}</pre>;
}

function StreamingSegmentBody({ segment }: { segment: StreamingMessageSegment }) {
  switch (segment.kind) {
    case "text":
    case "reasoning":
      return <StreamingTextBody segment={segment} />;
    case "tool":
      return <StreamingToolBody segment={segment} />;
    case "attachment":
      return <StreamingAttachmentBody segment={segment} />;
    case "source":
      return <StreamingSourceBody segment={segment} />;
    case "error":
      return <StreamingErrorBody segment={segment} />;
  }
}

function StreamingMessageSegmentView({
  segment,
  footer,
  className,
}: {
  segment: StreamingMessageSegment;
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <Message
      align="start"
      data-slot="streaming-message-segment"
      data-kind={segment.kind}
      data-state={segmentStatus(segment)}
      className={cn("streaming-message-segment", className)}
    >
      <MessageContent>
        <StreamingSegmentHeader segment={segment} />
        <StreamingSegmentBody segment={segment} />
        <MessageFooter className="streaming-message-footer">
          {footer ?? summarizeStreamingSegment(segment)}
        </MessageFooter>
      </MessageContent>
    </Message>
  );
}

function StreamingMessageStream({
  parts,
  emptyLabel = "No stream parts",
  footer,
  className,
  ...props
}: StreamingMessageStreamProps) {
  const segments = React.useMemo(() => buildStreamingMessageSegments(parts), [parts]);

  return (
    <MessageGroup
      data-slot="streaming-message-stream"
      className={cn("streaming-message-stream", className)}
      {...props}
    >
      {segments.length === 0 ? (
        <p className="streaming-message-empty">{emptyLabel}</p>
      ) : (
        segments.map((segment) => (
          <StreamingMessageSegmentView
            key={`${segment.kind}-${segment.id}`}
            segment={segment}
            footer={footer}
          />
        ))
      )}
    </MessageGroup>
  );
}

export {
  StreamingMessageSegmentView,
  StreamingMessageStream,
  buildStreamingMessageSegments,
  formatStreamingValue,
  summarizeStreamingSegment,
};
export type {
  StreamingKnownMessagePart,
  StreamingMessagePart,
  StreamingMessagePartInput,
  StreamingMessageSegment,
};
