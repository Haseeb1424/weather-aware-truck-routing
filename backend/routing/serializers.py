from datetime import timedelta

from django.utils import timezone
from rest_framework import serializers

MAX_LOAD_LB = 80_000  # US federal gross weight limit without a permit
MAX_LEAD = timedelta(days=14)  # stays inside Open-Meteo's 16-day forecast horizon
MAX_PAST = timedelta(hours=2)


class PointSerializer(serializers.Serializer):
    lat = serializers.FloatField(min_value=-90, max_value=90)
    lon = serializers.FloatField(min_value=-180, max_value=180)
    label = serializers.CharField(required=False, allow_blank=True, max_length=300)


def validate_departure(value):
    if timezone.is_naive(value):
        raise serializers.ValidationError("Departure must include a time zone offset.")
    now = timezone.now()
    if value < now - MAX_PAST:
        raise serializers.ValidationError("Departure can't be in the past.")
    if value > now + MAX_LEAD:
        raise serializers.ValidationError("Departure must be within 14 days (forecast horizon).")
    return value


class PlanRequestSerializer(serializers.Serializer):
    origin = PointSerializer()
    destination = PointSerializer()
    departure = serializers.DateTimeField(validators=[validate_departure])
    load_lb = serializers.FloatField(min_value=0, max_value=MAX_LOAD_LB)
    interval_mi = serializers.ChoiceField(choices=[10, 25, 50], default=25)

    def validate(self, attrs):
        o, d = attrs["origin"], attrs["destination"]
        if abs(o["lat"] - d["lat"]) < 1e-4 and abs(o["lon"] - d["lon"]) < 1e-4:
            raise serializers.ValidationError("Origin and destination are the same place.")
        return attrs


class HeatmapRequestSerializer(serializers.Serializer):
    departure = serializers.DateTimeField(validators=[validate_departure])
    load_lb = serializers.FloatField(min_value=0, max_value=MAX_LOAD_LB)
    lines = serializers.ListField(
        child=serializers.ListField(
            child=serializers.ListField(child=serializers.FloatField(), min_length=2, max_length=2),
            min_length=2,
            max_length=20_000,
        ),
        min_length=1,
        max_length=3,
    )
