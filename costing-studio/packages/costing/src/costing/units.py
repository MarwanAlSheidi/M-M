from __future__ import annotations
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Dict

_MASS_TO_KG: Dict[str, Decimal] = {
    "kg": Decimal("1"), "g": Decimal("0.001"), "tonne": Decimal("1000"),
    "mt": Decimal("1000"), "lb": Decimal("0.45359237"),
}


@dataclass(frozen=True)
class ContainerConfig:
    """Payloads are config, not constants."""
    payload_kg: Dict[str, Decimal] = field(default_factory=lambda: {
        "20ft_reefer": Decimal("18000"),
        "40ft_reefer": Decimal("25000"),
        "40ft_hc_reefer": Decimal("26000"),
    })

    def payload(self, container: str) -> Decimal:
        try:
            return self.payload_kg[container]
        except KeyError:
            raise ValueError(f"Unknown container: {container}") from None


DEFAULT_CONTAINERS = ContainerConfig()


def convert_mass(value: Decimal, frm: str, to: str) -> Decimal:
    if frm not in _MASS_TO_KG or to not in _MASS_TO_KG:
        raise ValueError(f"Unsupported mass unit: {frm} -> {to}")
    return value * _MASS_TO_KG[frm] / _MASS_TO_KG[to]


def container_to_kg(container: str, cfg: ContainerConfig = DEFAULT_CONTAINERS) -> Decimal:
    return cfg.payload(container)


def case_to_kg(cases: Decimal, kg_per_case: Decimal) -> Decimal:
    return cases * kg_per_case
