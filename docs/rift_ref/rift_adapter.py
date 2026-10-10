"""
RIFT Security Platform Integration Adapter
Dedicated service interface communicating with the RIFT Core Platform.
Never fabricates responses when RIFT is unavailable; raises explicit RiftUnavailableException.
"""

from abc import ABC, abstractmethod
from typing import Dict, Any, Optional
import httpx
from app.core.config import settings

class RiftUnavailableException(Exception):
    """Raised when RIFT Security Service is unreachable or returns a 5xx error."""
    pass

class RiftRejectedException(Exception):
    """Raised when RIFT Security Policy Engine explicitly rejects a transfer intent."""
    pass

class IRiftAdapter(ABC):
    @abstractmethod
    async def check_health(self) -> Dict[str, Any]:
        """Checks connectivity with RIFT service."""
        pass

    @abstractmethod
    async def submit_intent(self, intent_payload: Dict[str, Any]) -> Dict[str, Any]:
        """Submits cross-chain transfer intent to RIFT for policy evaluation."""
        pass

    @abstractmethod
    async def get_operation_status(self, rift_operation_id: str) -> Dict[str, Any]:
        """Fetches current operation state and verified blockchain evidence."""
        pass

    @abstractmethod
    async def authorize_operation(self, rift_operation_id: str, approver: str, auth_token: str, comments: Optional[str]) -> Dict[str, Any]:
        """Executes RIFT KEY authorization workflow."""
        pass

    @abstractmethod
    async def get_investigation_case(self, rift_operation_id: str) -> Dict[str, Any]:
        """Fetches investigation evidence and forensic logs."""
        pass


class RiftServiceAdapter(IRiftAdapter):
    def __init__(self, base_url: str = settings.RIFT_API_BASE_URL, api_key: str = settings.RIFT_API_KEY):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.headers = {
            "Content-Type": "application/json",
            "X-RIFT-API-Key": self.api_key
        }
        self.timeout = settings.RIFT_TIMEOUT_SECONDS

    async def check_health(self) -> Dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                res = await client.get(f"{self.base_url}/health")
                if res.status_code == 200:
                    data = res.json()
                    return {"connected": True, "data": data}
                return {"connected": False, "error": f"RIFT HTTP {res.status_code}"}
        except Exception as e:
            return {
                "connected": False,
                "error": "RIFT CONNECTION UNAVAILABLE",
                "detail": str(e)
            }

    async def submit_intent(self, intent_payload: Dict[str, Any]) -> Dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                res = await client.post(
                    f"{self.base_url}/transfers/intent",
                    json=intent_payload,
                    headers=self.headers
                )
                if res.status_code in (200, 201):
                    return res.json()
                elif res.status_code == 400 or res.status_code == 403:
                    error_detail = res.json().get("detail", "Transfer rejected by RIFT security policy")
                    raise RiftRejectedException(error_detail)
                else:
                    raise RiftUnavailableException(f"RIFT service error: HTTP {res.status_code}")
        except httpx.RequestError as e:
            raise RiftUnavailableException("RIFT CONNECTION UNAVAILABLE") from e

    async def get_operation_status(self, rift_operation_id: str) -> Dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                res = await client.get(
                    f"{self.base_url}/operations/{rift_operation_id}",
                    headers=self.headers
                )
                if res.status_code == 200:
                    return res.json()
                elif res.status_code == 404:
                    raise KeyError(f"Operation {rift_operation_id} not found in RIFT")
                else:
                    raise RiftUnavailableException(f"RIFT service returned HTTP {res.status_code}")
        except httpx.RequestError as e:
            raise RiftUnavailableException("RIFT CONNECTION UNAVAILABLE") from e

    async def authorize_operation(self, rift_operation_id: str, approver: str, auth_token: str, comments: Optional[str]) -> Dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                payload = {
                    "auth_token": auth_token,
                    "approver": approver,
                    "comments": comments or "Approved via RIFT KEY Security Protocol"
                }
                res = await client.post(
                    f"{self.base_url}/operations/{rift_operation_id}/authorize",
                    json=payload,
                    headers=self.headers
                )
                if res.status_code == 200:
                    return res.json()
                else:
                    raise RiftUnavailableException(f"RIFT authorization error: HTTP {res.status_code}")
        except httpx.RequestError as e:
            raise RiftUnavailableException("RIFT CONNECTION UNAVAILABLE") from e

    async def get_investigation_case(self, rift_operation_id: str) -> Dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                res = await client.get(
                    f"{self.base_url}/investigation/{rift_operation_id}",
                    headers=self.headers
                )
                if res.status_code == 200:
                    return res.json()
                else:
                    raise RiftUnavailableException(f"RIFT investigation error: HTTP {res.status_code}")
        except httpx.RequestError as e:
            raise RiftUnavailableException("RIFT CONNECTION UNAVAILABLE") from e

# Default instance
rift_adapter = RiftServiceAdapter()
