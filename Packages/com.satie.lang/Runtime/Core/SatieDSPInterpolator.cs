using UnityEngine;

namespace Satie
{
    /// <summary>
    /// DSP-based interpolation that uses DSP clock instead of Time.deltaTime.
    /// Drop-in replacement for InterpolatedAudioSource that provides sample-accurate timing.
    /// </summary>
    public class SatieDSPInterpolator : MonoBehaviour
    {
        private AudioSource audioSource;
        private DSPInterpolationManager interpolationManager;
        private float childVolumeMultiplier = 1f;
        private float childPitchMultiplier = 1f;

        private SatieDSPClock dspClock;
        private SatieRandom random;
        private double lastUpdateTime;

        void Awake()
        {
            audioSource = GetComponent<AudioSource>();
        }

        public void Initialize(SatieDSPClock clock, SatieRandom rng)
        {
            dspClock = clock;
            random = rng;
            lastUpdateTime = clock.CurrentTime;
            interpolationManager = new DSPInterpolationManager(clock, rng);
        }

        public void SetupInterpolations(Statement stmt)
        {
            childVolumeMultiplier = random.Sample(stmt.volume);
            childPitchMultiplier = random.Sample(stmt.pitch);

            interpolationManager.SetBaseValues(1f, 1f);

            if (stmt.volumeInterpolation != null)
            {
                interpolationManager.SetVolumeInterpolation(stmt.volumeInterpolation);
            }

            if (stmt.pitchInterpolation != null)
            {
                interpolationManager.SetPitchInterpolation(stmt.pitchInterpolation);
            }

            // Set initial values
            if (stmt.volumeInterpolation != null &&
                stmt.volumeInterpolation.interpolationType == InterpolationType.Goto)
            {
                audioSource.volume = stmt.volumeInterpolation.minValue * childVolumeMultiplier;
            }
            else
            {
                audioSource.volume = childVolumeMultiplier;
            }

            if (stmt.pitchInterpolation != null &&
                stmt.pitchInterpolation.interpolationType == InterpolationType.Goto)
            {
                audioSource.pitch = stmt.pitchInterpolation.minValue * childPitchMultiplier;
            }
            else
            {
                audioSource.pitch = childPitchMultiplier;
            }
        }

        void Update()
        {
            if (audioSource && interpolationManager != null && dspClock != null)
            {
                double currentTime = dspClock.CurrentTime;
                double deltaTime = currentTime - lastUpdateTime;
                lastUpdateTime = currentTime;

                audioSource.volume = interpolationManager.GetVolume(deltaTime) * childVolumeMultiplier;
                audioSource.pitch = interpolationManager.GetPitch(deltaTime) * childPitchMultiplier;
            }
        }

        public void ResetInterpolations()
        {
            interpolationManager?.ResetInterpolations();
            lastUpdateTime = dspClock.CurrentTime;
        }
    }

    /// <summary>
    /// DSP-based interpolation data that tracks time using DSP clock
    /// </summary>
    public class DSPInterpolationData
    {
        public RangeOrValue minRange;
        public RangeOrValue maxRange;
        public RangeOrValue durationRange;
        public string easeName;
        public float minValue;
        public float maxValue;
        public EaseFunctions.EaseFunction easeFunction;
        public double duration;
        public int repeatCount;
        public bool isForever;
        public double currentTime;
        public int currentRepeat;
        public bool isActive;
        public InterpolationType interpolationType;

        private SatieRandom random;

        public DSPInterpolationData(InterpolationData source, SatieRandom rng)
        {
            minRange = source.minRange;
            maxRange = source.maxRange;
            durationRange = source.durationRange;
            easeName = source.easeName;
            interpolationType = source.interpolationType;
            random = rng;

            // Sample initial values using seeded random
            minValue = rng.Sample(minRange);
            maxValue = rng.Sample(maxRange);
            duration = rng.Sample(durationRange);

            easeFunction = EaseFunctions.GetEaseFunction(easeName);
            repeatCount = source.repeatCount;
            isForever = source.isForever;
            currentTime = 0.0;
            currentRepeat = 0;
            isActive = true;
        }

        public float GetValue(double deltaTime)
        {
            if (!isActive)
            {
                if (interpolationType == InterpolationType.Goto)
                    return maxValue;
                return minValue;
            }

            currentTime += deltaTime;

            if (interpolationType == InterpolationType.GoBetween)
            {
                double totalDuration = duration * 2.0;

                while (currentTime >= totalDuration)
                {
                    currentTime -= totalDuration;
                    if (!isForever)
                    {
                        currentRepeat++;
                        if (currentRepeat >= repeatCount)
                        {
                            isActive = false;
                            return minValue;
                        }
                    }

                    // Re-sample ranges using seeded random
                    if (minRange.isRange)
                        minValue = random.Sample(minRange);
                    if (maxRange.isRange)
                        maxValue = random.Sample(maxRange);
                    if (durationRange.isRange)
                    {
                        duration = random.Sample(durationRange);
                        totalDuration = duration * 2.0;
                    }
                }

                float t;
                if (currentTime < duration)
                {
                    // Going from min to max
                    t = (float)(currentTime / duration);
                    float easedT = Mathf.Clamp01(easeFunction(t));
                    return Mathf.Lerp(minValue, maxValue, easedT);
                }
                else
                {
                    // Returning from max to min
                    t = (float)((currentTime - duration) / duration);
                    float easedT = Mathf.Clamp01(easeFunction(t));
                    return Mathf.Lerp(maxValue, minValue, easedT);
                }
            }
            else  // Goto or Interpolate
            {
                while (currentTime >= duration)
                {
                    if (interpolationType == InterpolationType.Goto)
                    {
                        isActive = false;
                        return maxValue;
                    }

                    currentTime -= duration;
                    if (!isForever)
                    {
                        currentRepeat++;
                        if (currentRepeat >= repeatCount)
                        {
                            isActive = false;
                            return maxValue;
                        }
                    }

                    // Re-sample ranges using seeded random
                    if (minRange.isRange)
                        minValue = random.Sample(minRange);
                    if (maxRange.isRange)
                        maxValue = random.Sample(maxRange);
                    if (durationRange.isRange)
                        duration = random.Sample(durationRange);
                }

                float t = (float)(currentTime / duration);
                float easedT = Mathf.Clamp01(easeFunction(t));
                return Mathf.Lerp(minValue, maxValue, easedT);
            }
        }

        public void Reset()
        {
            currentTime = 0.0;
            currentRepeat = 0;
            isActive = true;
            minValue = random.Sample(minRange);
            maxValue = random.Sample(maxRange);
            duration = random.Sample(durationRange);
        }
    }

    /// <summary>
    /// Manages DSP-based interpolations for volume and pitch
    /// </summary>
    public class DSPInterpolationManager
    {
        public DSPInterpolationData volumeInterp;
        public DSPInterpolationData pitchInterp;

        private float baseVolume = 1f;
        private float basePitch = 1f;

        private SatieDSPClock dspClock;
        private SatieRandom random;

        public DSPInterpolationManager(SatieDSPClock clock, SatieRandom rng)
        {
            dspClock = clock;
            random = rng;
        }

        public void SetBaseValues(float volume, float pitch)
        {
            baseVolume = volume;
            basePitch = pitch;
        }

        public void SetVolumeInterpolation(InterpolationData source)
        {
            volumeInterp = new DSPInterpolationData(source, random);
        }

        public void SetPitchInterpolation(InterpolationData source)
        {
            pitchInterp = new DSPInterpolationData(source, random);
        }

        public float GetVolume(double deltaTime)
        {
            if (volumeInterp != null)
            {
                if (volumeInterp.interpolationType == InterpolationType.Goto || volumeInterp.isActive)
                {
                    return volumeInterp.GetValue(deltaTime);
                }
            }
            return baseVolume;
        }

        public float GetPitch(double deltaTime)
        {
            if (pitchInterp != null)
            {
                if (pitchInterp.interpolationType == InterpolationType.Goto || pitchInterp.isActive)
                {
                    return pitchInterp.GetValue(deltaTime);
                }
            }
            return basePitch;
        }

        public void ResetInterpolations()
        {
            volumeInterp?.Reset();
            pitchInterp?.Reset();
        }
    }
}
