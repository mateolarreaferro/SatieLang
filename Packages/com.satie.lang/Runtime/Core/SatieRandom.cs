using System;

namespace Satie
{
    /// <summary>
    /// Seeded random number generator for reproducible Satie renders.
    ///
    /// Using the same seed will produce identical sequences of random values,
    /// enabling deterministic playback and offline rendering.
    /// </summary>
    public class SatieRandom
    {
        private System.Random rng;
        private int seed;

        /// <summary>
        /// The seed used to initialize this random generator
        /// </summary>
        public int Seed => seed;

        /// <summary>
        /// Create a new random generator with the specified seed
        /// </summary>
        public SatieRandom(int seed)
        {
            this.seed = seed;
            this.rng = new System.Random(seed);
        }

        /// <summary>
        /// Create a new random generator with a time-based seed
        /// </summary>
        public SatieRandom()
        {
            this.seed = Environment.TickCount;
            this.rng = new System.Random(seed);
        }

        /// <summary>
        /// Reset the random generator to its initial state
        /// </summary>
        public void Reset()
        {
            rng = new System.Random(seed);
        }

        /// <summary>
        /// Reset with a new seed
        /// </summary>
        public void Reset(int newSeed)
        {
            seed = newSeed;
            rng = new System.Random(seed);
        }

        /// <summary>
        /// Get a random float in range [0, 1)
        /// </summary>
        public float Value()
        {
            return (float)rng.NextDouble();
        }

        /// <summary>
        /// Get a random float in range [min, max)
        /// </summary>
        public float Range(float min, float max)
        {
            return min + (float)rng.NextDouble() * (max - min);
        }

        /// <summary>
        /// Get a random int in range [min, max) (max exclusive)
        /// </summary>
        public int Range(int min, int max)
        {
            return rng.Next(min, max);
        }

        /// <summary>
        /// Get a random int in range [0, max) (max exclusive)
        /// </summary>
        public int Range(int max)
        {
            return rng.Next(max);
        }

        /// <summary>
        /// Sample a value from a RangeOrValue using this RNG
        /// </summary>
        public float Sample(RangeOrValue rangeOrValue)
        {
            if (!rangeOrValue.isSet) return 0f;
            return Range(rangeOrValue.min, rangeOrValue.max);
        }

        /// <summary>
        /// Choose a random element from an array
        /// </summary>
        public T Choose<T>(T[] array)
        {
            if (array == null || array.Length == 0)
                throw new ArgumentException("Array cannot be null or empty");

            return array[rng.Next(array.Length)];
        }
    }
}
