"""
WebSocket Notifier
Sends real-time deployment updates to connected clients.
Supports multiple channels for different deployment sessions.
"""

import json
import asyncio
from typing import Dict, Any, Optional, Set, Callable
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum


class EventType(Enum):
    """WebSocket event types for deployment updates"""
    # Deployment lifecycle
    DEPLOYMENT_STARTED = "deployment_started"
    DEPLOYMENT_COMPLETED = "deployment_completed"
    DEPLOYMENT_FAILED = "deployment_failed"

    # Phase events
    PHASE_STARTED = "phase_started"
    PHASE_COMPLETED = "phase_completed"
    PHASE_FAILED = "phase_failed"

    # Skill events
    SKILL_STARTED = "skill_started"
    SKILL_COMPLETED = "skill_completed"
    SKILL_FAILED = "skill_failed"

    # Resource events
    RESOURCE_CREATING = "resource_creating"
    RESOURCE_CREATED = "resource_created"
    RESOURCE_FAILED = "resource_failed"

    # Progress
    PROGRESS = "progress"

    # Rollback
    ROLLBACK_STARTED = "rollback_started"
    ROLLBACK_COMPLETED = "rollback_completed"


@dataclass
class WebSocketMessage:
    """A WebSocket message to be sent"""
    channel: str
    event: str
    data: Dict[str, Any]
    timestamp: str = field(default_factory=lambda: datetime.utcnow().isoformat())

    def to_json(self) -> str:
        return json.dumps({
            "channel": self.channel,
            "event": self.event,
            "data": self.data,
            "timestamp": self.timestamp
        })


class WebSocketNotifier:
    """
    Manages WebSocket notifications for deployment events.

    Channels follow the pattern: deploy:{deployment_id}

    Usage:
        notifier = WebSocketNotifier()
        await notifier.send("deploy:abc123", "phase_started", {"phase": "aws_provisioning"})
    """

    def __init__(self, broadcast_fn: Optional[Callable] = None):
        """
        Initialize the notifier.

        Args:
            broadcast_fn: Optional function to broadcast messages.
                         If not provided, messages are queued for retrieval.
        """
        self.broadcast_fn = broadcast_fn
        self.message_queue: Dict[str, list] = {}  # channel -> messages
        self.subscribers: Dict[str, Set[str]] = {}  # channel -> connection_ids

    async def send(
        self,
        channel: str,
        event: str,
        data: Dict[str, Any]
    ):
        """
        Send a message to a channel.

        Args:
            channel: The channel to send to (e.g., "deploy:abc123")
            event: The event type
            data: Event data
        """
        message = WebSocketMessage(
            channel=channel,
            event=event,
            data=data
        )

        # If we have a broadcast function, use it
        if self.broadcast_fn:
            try:
                await self.broadcast_fn(channel, message.to_json())
            except Exception as e:
                print(f"WebSocket broadcast failed: {e}")
                # Fall back to queueing
                self._queue_message(channel, message)
        else:
            # Queue the message for later retrieval
            self._queue_message(channel, message)

        # Log the event
        print(f"[WS] {channel} -> {event}: {json.dumps(data)[:100]}")

    def _queue_message(self, channel: str, message: WebSocketMessage):
        """Queue a message for later retrieval"""
        if channel not in self.message_queue:
            self.message_queue[channel] = []
        self.message_queue[channel].append(message)

        # Keep only last 100 messages per channel
        if len(self.message_queue[channel]) > 100:
            self.message_queue[channel] = self.message_queue[channel][-100:]

    def get_messages(
        self,
        channel: str,
        since_timestamp: Optional[str] = None
    ) -> list:
        """
        Get queued messages for a channel.

        Args:
            channel: The channel to get messages from
            since_timestamp: Optional ISO timestamp to filter messages after

        Returns:
            List of messages
        """
        messages = self.message_queue.get(channel, [])

        if since_timestamp:
            messages = [
                m for m in messages
                if m.timestamp > since_timestamp
            ]

        return [m.to_json() for m in messages]

    def clear_channel(self, channel: str):
        """Clear all messages for a channel"""
        if channel in self.message_queue:
            del self.message_queue[channel]

    def subscribe(self, channel: str, connection_id: str):
        """Subscribe a connection to a channel"""
        if channel not in self.subscribers:
            self.subscribers[channel] = set()
        self.subscribers[channel].add(connection_id)

    def unsubscribe(self, channel: str, connection_id: str):
        """Unsubscribe a connection from a channel"""
        if channel in self.subscribers:
            self.subscribers[channel].discard(connection_id)

    def get_subscribers(self, channel: str) -> Set[str]:
        """Get all subscribers for a channel"""
        return self.subscribers.get(channel, set())

    # Convenience methods for common events

    async def deployment_started(
        self,
        deployment_id: str,
        project_name: str,
        project_type: str
    ):
        """Notify that a deployment has started"""
        await self.send(
            f"deploy:{deployment_id}",
            EventType.DEPLOYMENT_STARTED.value,
            {
                "deployment_id": deployment_id,
                "project_name": project_name,
                "project_type": project_type
            }
        )

    async def deployment_completed(
        self,
        deployment_id: str,
        deployment_url: str
    ):
        """Notify that a deployment has completed"""
        await self.send(
            f"deploy:{deployment_id}",
            EventType.DEPLOYMENT_COMPLETED.value,
            {
                "deployment_id": deployment_id,
                "deployment_url": deployment_url,
                "status": "completed"
            }
        )

    async def deployment_failed(
        self,
        deployment_id: str,
        error: str,
        details: Optional[Dict[str, Any]] = None
    ):
        """Notify that a deployment has failed"""
        await self.send(
            f"deploy:{deployment_id}",
            EventType.DEPLOYMENT_FAILED.value,
            {
                "deployment_id": deployment_id,
                "error": error,
                "details": details or {},
                "status": "failed"
            }
        )

    async def phase_update(
        self,
        deployment_id: str,
        phase: str,
        status: str,
        message: str
    ):
        """Notify about a phase update"""
        event = EventType.PHASE_STARTED if status == "started" else \
                EventType.PHASE_COMPLETED if status == "completed" else \
                EventType.PHASE_FAILED

        await self.send(
            f"deploy:{deployment_id}",
            event.value,
            {
                "phase": phase,
                "status": status,
                "message": message
            }
        )

    async def skill_update(
        self,
        deployment_id: str,
        skill: str,
        status: str,
        issues_count: int = 0
    ):
        """Notify about a skill check update"""
        event = EventType.SKILL_STARTED if status == "started" else \
                EventType.SKILL_COMPLETED if status == "completed" else \
                EventType.SKILL_FAILED

        await self.send(
            f"deploy:{deployment_id}",
            event.value,
            {
                "skill": skill,
                "status": status,
                "issues_count": issues_count
            }
        )

    async def resource_update(
        self,
        deployment_id: str,
        resource_type: str,
        status: str,
        details: Optional[Dict[str, Any]] = None
    ):
        """Notify about a resource creation/update"""
        event = EventType.RESOURCE_CREATING if status == "creating" else \
                EventType.RESOURCE_CREATED if status == "created" else \
                EventType.RESOURCE_FAILED

        await self.send(
            f"deploy:{deployment_id}",
            event.value,
            {
                "resource_type": resource_type,
                "status": status,
                **(details or {})
            }
        )

    async def progress_update(
        self,
        deployment_id: str,
        step: str,
        progress: int,
        message: Optional[str] = None
    ):
        """Notify about progress update"""
        await self.send(
            f"deploy:{deployment_id}",
            EventType.PROGRESS.value,
            {
                "step": step,
                "progress": progress,
                "message": message
            }
        )

    async def rollback_update(
        self,
        deployment_id: str,
        status: str,
        resources_deleted: int = 0,
        reason: Optional[str] = None
    ):
        """Notify about rollback status"""
        event = EventType.ROLLBACK_STARTED if status == "started" else \
                EventType.ROLLBACK_COMPLETED

        await self.send(
            f"deploy:{deployment_id}",
            event.value,
            {
                "status": status,
                "resources_deleted": resources_deleted,
                "reason": reason
            }
        )


# Integration with existing WebSocket server
class WebSocketBridge:
    """
    Bridge to integrate with existing WebSocket server.
    Adapts the notifier to work with different WS implementations.
    """

    def __init__(self, ws_server):
        """
        Initialize the bridge.

        Args:
            ws_server: The existing WebSocket server instance
        """
        self.ws_server = ws_server

    async def broadcast(self, channel: str, message: str):
        """
        Broadcast a message through the WebSocket server.

        Args:
            channel: The channel to broadcast to
            message: The JSON message string
        """
        # This method should be adapted to your WS server's API
        # Example for a typical implementation:
        if hasattr(self.ws_server, 'broadcast_to_channel'):
            await self.ws_server.broadcast_to_channel(channel, message)
        elif hasattr(self.ws_server, 'send_to_channel'):
            await self.ws_server.send_to_channel(channel, message)
        else:
            # Fallback: try to send to all connections in the channel
            connections = getattr(self.ws_server, 'connections', {})
            channel_connections = connections.get(channel, [])
            for conn in channel_connections:
                try:
                    await conn.send(message)
                except Exception:
                    pass


def create_notifier(ws_server=None) -> WebSocketNotifier:
    """
    Factory function to create a WebSocketNotifier.

    Args:
        ws_server: Optional WebSocket server to integrate with

    Returns:
        Configured WebSocketNotifier
    """
    if ws_server:
        bridge = WebSocketBridge(ws_server)
        return WebSocketNotifier(broadcast_fn=bridge.broadcast)
    return WebSocketNotifier()
