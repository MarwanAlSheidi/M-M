from decimal import Decimal
import pytest
from costing.units import ContainerConfig, container_to_kg, convert_mass


def test_convert_mass():
    assert convert_mass(Decimal("1"), "tonne", "kg") == Decimal("1000")
    with pytest.raises(ValueError):
        convert_mass(Decimal("1"), "kg", "litre")


def test_container_config():
    assert container_to_kg("20ft_reefer") == Decimal("18000")
    cfg = ContainerConfig(payload_kg={"20ft_reefer": Decimal("17000")})
    assert container_to_kg("20ft_reefer", cfg) == Decimal("17000")
