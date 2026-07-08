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
import { Bubble, BubbleContent } from "@/components/ui/bubble.tsx";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker.tsx";
import { Message, MessageContent, MessageFooter, MessageHeader } from "@/components/ui/message.tsx";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs.tsx";
import { cn } from "@/lib/utils.ts";

import {
  buildStreamingMessageModel,
  formatStreamingValue,
  summarizeStreamingSegment,
  type StreamingAttachmentSegment,
  type StreamingMessageModel,
  type StreamingMessagePart,
  type StreamingMessagePartEncoded,
  type StreamingMessageSegment,
  type StreamingSegmentStatus,
  type StreamingSourceSegment,
  type StreamingToolSegment,
} from "./stream-parts.ts";

type StreamingMessageStreamProps = React.ComponentProps<"div"> & {
  parts: ReadonlyArray<StreamingMessagePart>;
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

const statusBadgeVariant = (
  status: StreamingSegmentStatus,
): "destructive" | "outline" | "secondary" => {
  if (status === "failed") {
    return "destructive";
  }
  if (status === "complete") {
    return "secondary";
  }
  return "outline";
};

function StreamingStatusIcon({ status }: { status: StreamingSegmentStatus }) {
  switch (status) {
    case "streaming":
      return <LoaderCircleIcon data-icon="inline-start" />;
    case "failed":
      return <CircleAlertIcon data-icon="inline-start" />;
    case "approval-required":
      return <ShieldQuestionIcon data-icon="inline-start" />;
    case "preliminary":
    case "ready":
      return <Clock3Icon data-icon="inline-start" />;
    case "complete":
      return <CheckCircle2Icon data-icon="inline-start" />;
  }
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
    case "attachment":
    case "source":
      return "complete";
  }
};

const partCountLabel = (count: number): string => `${count} part${count === 1 ? "" : "s"}`;

const segmentPartCountLabel = (segment: StreamingMessageSegment): string =>
  partCountLabel(segment.partIndexes.length);

const segmentFirstPartIndex = (segment: StreamingMessageSegment): number =>
  segment.partIndexes[0] ?? 0;

function StatusBadge({ status }: { status: StreamingSegmentStatus }) {
  return (
    <Badge variant={statusBadgeVariant(status)}>
      <StreamingStatusIcon status={status} />
      {statusLabel(status)}
    </Badge>
  );
}

function StreamingAttachmentList({
  attachments,
}: {
  attachments: ReadonlyArray<StreamingAttachmentSegment>;
}) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <AttachmentGroup className="streaming-message-attachment-group">
      {attachments.map((attachment) => (
        <Attachment key={attachment.id} size="sm" state="done">
          <AttachmentMedia>
            <FileTextIcon />
          </AttachmentMedia>
          <AttachmentContent>
            <AttachmentTitle>{attachment.mediaType}</AttachmentTitle>
            <AttachmentDescription>{attachment.byteLength} bytes</AttachmentDescription>
          </AttachmentContent>
        </Attachment>
      ))}
    </AttachmentGroup>
  );
}

function StreamingSourceList({ sources }: { sources: ReadonlyArray<StreamingSourceSegment> }) {
  if (sources.length === 0) {
    return null;
  }

  return (
    <AttachmentGroup className="streaming-message-attachment-group">
      {sources.map((source) => {
        const description =
          source.sourceType === "url"
            ? source.url
            : `${source.mediaType}${source.fileName === undefined ? "" : ` · ${source.fileName}`}`;

        return (
          <Attachment key={source.id} size="sm" state="done">
            <AttachmentMedia>
              {source.sourceType === "url" ? <LinkIcon /> : <FileTextIcon />}
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle>{source.title}</AttachmentTitle>
              <AttachmentDescription>{description}</AttachmentDescription>
            </AttachmentContent>
          </Attachment>
        );
      })}
    </AttachmentGroup>
  );
}

function StreamingToolsMarker({ tools }: { tools: ReadonlyArray<StreamingToolSegment> }) {
  if (tools.length === 0) {
    return null;
  }

  return (
    <Marker>
      <MarkerIcon>
        <WrenchIcon />
      </MarkerIcon>
      <MarkerContent className="streaming-message-marker-content">
        {tools.map((tool) => (
          <Badge key={tool.id} variant={statusBadgeVariant(tool.status)}>
            {tool.name.length > 0 ? tool.name : tool.id}
            {" · "}
            {statusLabel(tool.status)}
          </Badge>
        ))}
      </MarkerContent>
    </Marker>
  );
}

function StreamingReasoningMarker({ reasoning }: { reasoning: string }) {
  if (reasoning.length === 0) {
    return null;
  }

  return (
    <Marker>
      <MarkerIcon>
        <BrainIcon />
      </MarkerIcon>
      <MarkerContent className="streaming-message-reasoning">{reasoning}</MarkerContent>
    </Marker>
  );
}

function StreamingErrorsMarker({
  errors,
}: {
  errors: ReadonlyArray<Extract<StreamingMessageSegment, { kind: "error" }>>;
}) {
  if (errors.length === 0) {
    return null;
  }

  return (
    <Marker>
      <MarkerIcon>
        <CircleAlertIcon />
      </MarkerIcon>
      <MarkerContent className="streaming-message-marker-content">
        {errors.map((error) => (
          <Badge key={error.id} variant="destructive">
            {formatStreamingValue(error.error)}
          </Badge>
        ))}
      </MarkerContent>
    </Marker>
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

function StreamingToolDetails({ segment }: { segment: StreamingToolSegment }) {
  const hasParamsText = segment.paramsText.length > 0;
  const hasStructuredParams = segment.params !== undefined;
  const hasResult = segment.result !== undefined;

  return (
    <Bubble variant={segment.status === "failed" ? "destructive" : "outline"} align="start">
      <BubbleContent className="streaming-message-debug-bubble">
        <div className="streaming-message-debug-stack">
          <div className="streaming-message-debug-meta">
            <span>{segment.providerExecuted ? "Provider executed" : "Framework executed"}</span>
            <span>{segment.id}</span>
          </div>
          {segment.approvalId === undefined ? null : (
            <Marker>
              <MarkerIcon>
                <ShieldQuestionIcon />
              </MarkerIcon>
              <MarkerContent>Approval required: {segment.approvalId}</MarkerContent>
            </Marker>
          )}
          {hasParamsText ? (
            <StreamingJsonBlock label="Streaming params" value={segment.paramsText} />
          ) : null}
          {hasStructuredParams ? (
            <StreamingJsonBlock label="Params" value={segment.params} />
          ) : null}
          {hasResult ? (
            <StreamingJsonBlock
              label={segment.isFailure ? "Failure" : "Result"}
              value={segment.result}
            />
          ) : null}
          {!hasParamsText && !hasStructuredParams && !hasResult ? (
            <span
              className={cn(
                "streaming-message-placeholder",
                segment.status === "streaming" && "shimmer",
              )}
            >
              Waiting for tool parameters
            </span>
          ) : null}
        </div>
      </BubbleContent>
    </Bubble>
  );
}

function StreamingTextDetails({
  segment,
}: {
  segment: Extract<StreamingMessageSegment, { kind: "text" | "reasoning" }>;
}) {
  const isEmpty = segment.text.length === 0;

  return (
    <Bubble variant={segment.kind === "reasoning" ? "ghost" : "outline"} align="start">
      <BubbleContent>
        <pre
          className={cn(
            "streaming-message-pre",
            isEmpty && "streaming-message-placeholder",
            isEmpty && segment.status === "streaming" && "shimmer",
          )}
        >
          {isEmpty ? "Waiting for stream delta" : segment.text}
        </pre>
      </BubbleContent>
    </Bubble>
  );
}

function StreamingDebugSegmentBody({ segment }: { segment: StreamingMessageSegment }) {
  switch (segment.kind) {
    case "text":
    case "reasoning":
      return <StreamingTextDetails segment={segment} />;
    case "tool":
      return <StreamingToolDetails segment={segment} />;
    case "attachment":
      return <StreamingAttachmentList attachments={[segment]} />;
    case "source":
      return <StreamingSourceList sources={[segment]} />;
    case "error":
      return (
        <Bubble variant="destructive" align="start">
          <BubbleContent>
            <pre className="streaming-message-pre">{formatStreamingValue(segment.error)}</pre>
          </BubbleContent>
        </Bubble>
      );
  }
}

function StreamingDebugSegmentView({
  segment,
  footer,
}: {
  segment: StreamingMessageSegment;
  footer?: React.ReactNode;
}) {
  const status = segmentStatus(segment);

  return (
    <Message align="start" data-kind={segment.kind} data-state={status}>
      <MessageContent>
        <MessageHeader className="streaming-message-header">
          <span className="streaming-message-title">
            <StreamingSegmentIcon segment={segment} />
            {segmentTitle(segment)}
          </span>
          <span className="streaming-message-header-meta">
            <StatusBadge status={status} />
            <span>{segmentPartCountLabel(segment)}</span>
          </span>
        </MessageHeader>
        <StreamingDebugSegmentBody segment={segment} />
        <MessageFooter className="streaming-message-footer">
          {footer ?? summarizeStreamingSegment(segment)}
        </MessageFooter>
      </MessageContent>
    </Message>
  );
}

function StreamingMessagePrimary({
  model,
  emptyLabel,
  footer,
}: {
  model: StreamingMessageModel;
  emptyLabel: string;
  footer?: React.ReactNode;
}) {
  const message = model.message;
  const hasText = message.text.length > 0;
  const placeholder =
    message.partCount === 0
      ? emptyLabel
      : message.status === "streaming"
        ? "Waiting for assistant response"
        : "No assistant text";

  return (
    <Message align="start" data-state={message.status}>
      <MessageContent>
        <MessageHeader className="streaming-message-header">
          <span className="streaming-message-title">
            <MessageSquareTextIcon />
            Assistant
          </span>
          <span className="streaming-message-header-meta">
            <StatusBadge status={message.status} />
            <span>{partCountLabel(message.partCount)}</span>
          </span>
        </MessageHeader>
        <Bubble variant={message.status === "failed" ? "destructive" : "muted"} align="start">
          <BubbleContent>
            <div
              className={cn(
                "streaming-message-body",
                !hasText && "streaming-message-placeholder",
                !hasText && message.status === "streaming" && "shimmer",
              )}
            >
              {hasText ? message.text : placeholder}
            </div>
          </BubbleContent>
        </Bubble>
        <StreamingReasoningMarker reasoning={message.reasoning} />
        <StreamingAttachmentList attachments={message.attachments} />
        <StreamingSourceList sources={message.sources} />
        <StreamingToolsMarker tools={message.tools} />
        <StreamingErrorsMarker errors={message.errors} />
        <MessageFooter className="streaming-message-footer">
          {footer ?? statusLabel(message.status)}
        </MessageFooter>
      </MessageContent>
    </Message>
  );
}

function StreamingMessageScrollerPanel({ children }: { children: React.ReactNode }) {
  return (
    <MessageScrollerProvider autoScroll>
      <MessageScroller className="streaming-message-scroller">
        <MessageScrollerViewport>
          <MessageScrollerContent className="streaming-message-scroller-content">
            {children}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

function StreamingMessageStream({
  parts,
  emptyLabel = "No stream parts",
  footer,
  className,
  ...props
}: StreamingMessageStreamProps) {
  const model = React.useMemo(() => buildStreamingMessageModel(parts), [parts]);

  return (
    <div
      data-slot="streaming-message-stream"
      data-state={model.message.status}
      className={cn("streaming-message-stream", className)}
      {...props}
    >
      <Tabs defaultValue="message" className="streaming-message-tabs">
        <div className="streaming-message-tabs-header">
          <TabsList variant="line">
            <TabsTrigger value="message">
              <MessageSquareTextIcon data-icon="inline-start" />
              Message
            </TabsTrigger>
            <TabsTrigger value="debug">
              <WrenchIcon data-icon="inline-start" />
              Debug
            </TabsTrigger>
          </TabsList>
          <Badge variant={statusBadgeVariant(model.message.status)}>
            {statusLabel(model.message.status)}
          </Badge>
        </div>
        <TabsContent value="message" className="streaming-message-tab">
          <StreamingMessageScrollerPanel>
            <MessageScrollerItem messageId="streaming-message-primary" scrollAnchor>
              <StreamingMessagePrimary model={model} emptyLabel={emptyLabel} footer={footer} />
            </MessageScrollerItem>
          </StreamingMessageScrollerPanel>
        </TabsContent>
        <TabsContent value="debug" className="streaming-message-tab">
          <StreamingMessageScrollerPanel>
            {model.debugSegments.length === 0 ? (
              <MessageScrollerItem messageId="streaming-message-debug-empty">
                <Marker variant="separator">
                  <MarkerContent>{emptyLabel}</MarkerContent>
                </Marker>
              </MessageScrollerItem>
            ) : (
              model.debugSegments.map((segment) => (
                <MessageScrollerItem
                  key={`${segment.kind}-${segment.id}-${segmentFirstPartIndex(segment)}`}
                  messageId={`streaming-message-debug-${segment.kind}-${segment.id}-${segmentFirstPartIndex(segment)}`}
                  scrollAnchor={segment.kind === "text"}
                >
                  <StreamingDebugSegmentView segment={segment} footer={footer} />
                </MessageScrollerItem>
              ))
            )}
          </StreamingMessageScrollerPanel>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export {
  StreamingMessageStream,
  buildStreamingMessageModel,
  formatStreamingValue,
  summarizeStreamingSegment,
};
export type {
  StreamingMessageModel,
  StreamingMessagePart,
  StreamingMessagePartEncoded,
  StreamingMessageSegment,
  StreamingSegmentStatus,
};
