// Copyright (c) Meta Platforms, Inc. and affiliates.

"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AppShell } from "@astryxdesign/core/AppShell";
import { Divider } from "@astryxdesign/core/Divider";
import { Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { SideNav, SideNavHeading, SideNavItem, SideNavSection } from "@astryxdesign/core/SideNav";
import { NavIcon } from "@astryxdesign/core/NavIcon";
import { Icon } from "@astryxdesign/core/Icon";
import type { IconType } from "@astryxdesign/core/Icon";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import type { StatusDotVariant } from "@astryxdesign/core/StatusDot";
import { Card } from "@astryxdesign/core/Card";
import { Stack, VStack, HStack } from "@astryxdesign/core/Stack";
import {
  SparklesIcon,
  PlusIcon,
  MagnifyingGlassIcon,
  BookOpenIcon,
  Cog6ToothIcon,
  UserCircleIcon,
  UserIcon,
  BuildingOffice2Icon,
  CodeBracketIcon,
} from "@heroicons/react/24/outline";
import { useDashboardStore } from "./src/store.ts";

type Conversation = {
  label: string;
  status: StatusDotVariant;
  statusLabel: string;
};

type Workspace = {
  name: string;
  icon: IconType;
  chats: Conversation[];
};

const WORKSPACES: Workspace[] = [
  {
    name: "Personal",
    icon: UserIcon,
    chats: [
      {
        label: "Weekend trip planning",
        status: "success",
        statusLabel: "Active",
      },
      {
        label: "Recipe ideas for the week",
        status: "neutral",
        statusLabel: "Idle",
      },
      {
        label: "Book recommendations",
        status: "warning",
        statusLabel: "Needs review",
      },
      { label: "Home workout plan", status: "neutral", statusLabel: "Idle" },
    ],
  },
  {
    name: "Acme Corp",
    icon: BuildingOffice2Icon,
    chats: [
      { label: "Q3 roadmap draft", status: "accent", statusLabel: "In progress" },
      {
        label: "Customer onboarding flow",
        status: "success",
        statusLabel: "Active",
      },
      {
        label: "Pricing strategy review",
        status: "warning",
        statusLabel: "Needs review",
      },
      { label: "Standup summary", status: "neutral", statusLabel: "Idle" },
    ],
  },
  {
    name: "Open Source",
    icon: CodeBracketIcon,
    chats: [
      {
        label: "StyleX migration notes",
        status: "accent",
        statusLabel: "In progress",
      },
      {
        label: "Skeleton loading states",
        status: "success",
        statusLabel: "Active",
      },
      { label: "Accessibility audit", status: "error", statusLabel: "Blocked" },
      { label: "Release notes v4.0", status: "neutral", statusLabel: "Idle" },
    ],
  },
];

const MESSAGES = [
  { role: "assistant", width: "78%", height: 104 },
  { role: "user", width: "48%", height: 48 },
  { role: "assistant", width: "64%", height: 132 },
  { role: "user", width: "38%", height: 40 },
];

const SIDE_NAV_DEFAULT_WIDTH = 300;
const SIDE_NAV_MIN_WIDTH = 220;
const SIDE_NAV_MAX_WIDTH = 420;
const SIDE_NAV_COLLAPSED_WIDTH = 48;
const SIDE_NAV_MOTION_MS = 220;

function clampSideNavWidth(width: number) {
  return Math.min(Math.max(width, SIDE_NAV_MIN_WIDTH), SIDE_NAV_MAX_WIDTH);
}

function getSidebarMotionKey(element: Element, index: number) {
  const label =
    element.getAttribute("aria-label") ??
    element.getAttribute("href") ??
    element.textContent?.trim().replace(/\s+/g, " ").slice(0, 48) ??
    "";

  return `${element.tagName}:${label}:${index}`;
}

function captureSidebarMotionRects(root: HTMLElement) {
  const items = root.querySelectorAll(
    [
      ".astryx-side-nav-item",
      'button[aria-label="Collapse sidebar"]',
      'button[aria-label="Expand sidebar"]',
      '[role="navigation"] > div:first-child',
    ].join(", "),
  );

  return new Map(
    Array.from(items, (element, index) => [
      getSidebarMotionKey(element, index),
      element.getBoundingClientRect(),
    ]),
  );
}

function ConversationItem({
  label,
  status,
  statusLabel,
  isSelected,
}: {
  label: string;
  status: StatusDotVariant;
  statusLabel: string;
  isSelected?: boolean;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const showMenu = isHovered || isMenuOpen;

  return (
    <Stack onMouseEnter={() => setIsHovered(true)} onMouseLeave={() => setIsHovered(false)}>
      <SideNavItem
        label={label}
        href="#"
        isSelected={isSelected}
        endContent={
          showMenu ? (
            <MoreMenu
              size="sm"
              label="Conversation options"
              onOpenChange={setIsMenuOpen}
              items={[
                { label: "Pin", onClick: () => {} },
                { label: "Rename", onClick: () => {} },
                { label: "Archive", onClick: () => {} },
                { label: "Delete", onClick: () => {} },
              ]}
            />
          ) : (
            <StatusDot variant={status} label={statusLabel} />
          )
        }
      />
    </Stack>
  );
}

export default function ShellSideNav() {
  const selectedChatLabel = useDashboardStore((state) => state.selectedChatLabel);
  const selectChat = useDashboardStore((state) => state.selectChat);
  const sideNavShellRef = useRef<HTMLDivElement | null>(null);
  const expandedWidthRef = useRef(SIDE_NAV_DEFAULT_WIDTH);
  const pendingMotionRectsRef = useRef<Map<string, DOMRect> | null>(null);
  const requestedCollapsedRef = useRef(false);
  const transitionFrameRef = useRef<number | null>(null);
  const resizeStartRef = useRef<{ pointerX: number; width: number } | null>(null);
  const [isSideNavCollapsed, setIsSideNavCollapsed] = useState(false);
  const [sideNavWidth, setSideNavWidth] = useState(SIDE_NAV_DEFAULT_WIDTH);
  const [isSideNavResizing, setIsSideNavResizing] = useState(false);
  const [isSideNavTransitioning, setIsSideNavTransitioning] = useState(false);

  useEffect(
    () => () => {
      if (transitionFrameRef.current !== null) {
        window.cancelAnimationFrame(transitionFrameRef.current);
      }
    },
    [],
  );

  useLayoutEffect(() => {
    const root = sideNavShellRef.current;
    const previousRects = pendingMotionRectsRef.current;

    if (root == null || previousRects == null) {
      return;
    }

    pendingMotionRectsRef.current = null;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }

    const currentItems = root.querySelectorAll(
      [
        ".astryx-side-nav-item",
        'button[aria-label="Collapse sidebar"]',
        'button[aria-label="Expand sidebar"]',
        '[role="navigation"] > div:first-child',
      ].join(", "),
    );

    Array.from(currentItems).forEach((element, index) => {
      const previousRect = previousRects.get(getSidebarMotionKey(element, index));

      if (previousRect == null) {
        return;
      }

      const nextRect = element.getBoundingClientRect();
      const deltaX = previousRect.left - nextRect.left;
      const deltaY = previousRect.top - nextRect.top;

      if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) {
        return;
      }

      element.animate(
        [
          { transform: `translate(${deltaX}px, ${deltaY}px)` },
          { transform: "translate(0, 0)" },
        ],
        {
          duration: SIDE_NAV_MOTION_MS,
          easing: "cubic-bezier(0.16, 1, 0.3, 1)",
          fill: "both",
        },
      );
    });
  }, [isSideNavCollapsed]);

  useEffect(() => {
    if (!isSideNavResizing) {
      return;
    }

    const handlePointerMove = (event: MouseEvent) => {
      const start = resizeStartRef.current;

      if (start == null) {
        return;
      }

      const nextWidth = clampSideNavWidth(start.width + event.clientX - start.pointerX);
      expandedWidthRef.current = nextWidth;
      setSideNavWidth(nextWidth);
    };

    const handlePointerUp = () => {
      resizeStartRef.current = null;
      setIsSideNavResizing(false);
    };

    window.addEventListener("mousemove", handlePointerMove);
    window.addEventListener("mouseup", handlePointerUp);

    return () => {
      window.removeEventListener("mousemove", handlePointerMove);
      window.removeEventListener("mouseup", handlePointerUp);
    };
  }, [isSideNavResizing]);

  const handleSideNavResizeStart = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (isSideNavCollapsed || isSideNavTransitioning) {
        return;
      }

      event.preventDefault();
      resizeStartRef.current = {
        pointerX: event.clientX,
        width: expandedWidthRef.current,
      };
      setIsSideNavResizing(true);
    },
    [isSideNavCollapsed, isSideNavTransitioning],
  );

  const handleSideNavCollapseChange = useCallback((nextCollapsed: boolean) => {
    if (sideNavShellRef.current != null) {
      pendingMotionRectsRef.current = captureSidebarMotionRects(sideNavShellRef.current);
    }

    requestedCollapsedRef.current = nextCollapsed;

    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (prefersReducedMotion) {
      setIsSideNavCollapsed(nextCollapsed);
      setSideNavWidth(nextCollapsed ? SIDE_NAV_COLLAPSED_WIDTH : expandedWidthRef.current);
      setIsSideNavTransitioning(false);
      return;
    }

    setIsSideNavCollapsed(nextCollapsed);
    setIsSideNavTransitioning(true);

    if (nextCollapsed) {
      setSideNavWidth(SIDE_NAV_COLLAPSED_WIDTH);
      return;
    }

    if (transitionFrameRef.current !== null) {
      window.cancelAnimationFrame(transitionFrameRef.current);
    }

    transitionFrameRef.current = window.requestAnimationFrame(() => {
      setSideNavWidth(expandedWidthRef.current);
      transitionFrameRef.current = null;
    });
  }, []);

  const handleSideNavTransitionEnd = useCallback((event: React.TransitionEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.propertyName !== "width") {
      return;
    }

    setSideNavWidth(
      requestedCollapsedRef.current ? SIDE_NAV_COLLAPSED_WIDTH : expandedWidthRef.current,
    );
    setIsSideNavTransitioning(false);
  }, []);

  return (
    <AppShell
      contentPadding={0}
      sideNav={
        <div
          className="dashboard-side-nav-shell"
          data-resizing={isSideNavResizing}
          data-transitioning={isSideNavTransitioning}
          onTransitionEnd={handleSideNavTransitionEnd}
          ref={sideNavShellRef}
          style={{ flexBasis: sideNavWidth, width: sideNavWidth }}
        >
          <SideNav
            className="dashboard-side-nav"
            style={{ width: isSideNavCollapsed ? SIDE_NAV_COLLAPSED_WIDTH : "100%" }}
            collapsible={{
              isCollapsed: isSideNavCollapsed,
              onCollapsedChange: handleSideNavCollapseChange,
            }}
            header={
              <SideNavHeading
                heading="AI Assistant"
                icon={<NavIcon icon={<Icon icon={SparklesIcon} size="sm" />} />}
                headingHref="#"
              />
            }
            footer={
              <SideNavSection title="Account" isHeaderHidden>
                <SideNavItem label="Settings" icon={Cog6ToothIcon} href="#" />
                <SideNavItem label="Sarah Chen" icon={UserCircleIcon} href="#" />
              </SideNavSection>
            }
          >
            <SideNavSection title="Menu" isHeaderHidden>
              <SideNavItem label="New chat" icon={PlusIcon} href="#" />
              <SideNavItem label="Search" icon={MagnifyingGlassIcon} href="#" />
              <SideNavItem label="Library" icon={BookOpenIcon} href="#" />
            </SideNavSection>
            <Divider />
            <SideNavSection title="Workspaces" isHeaderHidden>
              {WORKSPACES.map((workspace) => (
                <SideNavItem
                  key={workspace.name}
                  label={workspace.name}
                  icon={workspace.icon}
                  collapsible={{ defaultIsCollapsed: false }}
                >
                  <VStack gap={0.5}>
                    {workspace.chats.map((chat) => (
                      <Stack key={chat.label} onClick={() => selectChat(chat.label)}>
                        <ConversationItem
                          label={chat.label}
                          status={chat.status}
                          statusLabel={chat.statusLabel}
                          isSelected={chat.label === selectedChatLabel}
                        />
                      </Stack>
                    ))}
                  </VStack>
                </SideNavItem>
              ))}
            </SideNavSection>
          </SideNav>
          {!isSideNavCollapsed && (
            <div
              aria-hidden="true"
              className="dashboard-side-nav-resize-handle"
              onMouseDown={handleSideNavResizeStart}
            />
          )}
        </div>
      }
    >
      <Layout
        height="fill"
        contentWidth={768}
        content={
          <LayoutContent padding={6}>
            <VStack gap={5}>
              {MESSAGES.map((message, mi) => (
                <HStack key={mi} hAlign={message.role === "assistant" ? "start" : "end"}>
                  <Card variant="muted" padding={0} width={message.width} height={message.height} />
                </HStack>
              ))}
            </VStack>
          </LayoutContent>
        }
        footer={
          <LayoutFooter>
            <Card variant="muted" padding={0} width="100%" height={56} />
          </LayoutFooter>
        }
      />
    </AppShell>
  );
}
