using UnityEngine;
using System.Collections;

public class ForestScene : MonoBehaviour
{
    public AudioClip wind, bird, twig, firefly, owl, creek;
    float groupVol;

    void Start()
    {
        StartCoroutine(GroupFadeIn(5f));

        // Wind loop with animated lowpass filter
        var windSrc = MakeSrc(wind, true, 0.3f);
        var lpf = windSrc.gameObject.AddComponent<AudioLowPassFilter>();
        lpf.cutoffFrequency = 800f;
        windSrc.Play();
        StartCoroutine(OscillateFilter(lpf, 800f, 3000f, 8f));

        // 5 birds: volume 0.1-0.4, pitch 0.8-1.3, fly, trail, color green
        for (int i = 0; i < 5; i++)
            StartCoroutine(OneshotLoop(bird, 3f, 8f, 0.1f, 0.4f, 0.8f, 1.3f, go => {
                AddFlyMovement(go.transform, new Vector3(-5, -5, -5), new Vector3(5, 5, 5),
                    Random.Range(1f, 2f));
                AddTrail(go, Color.green);
            }));

        // 3 twigs: volume 0.05-0.15, pitch 0.9-1.2, walk
        for (int i = 0; i < 3; i++)
            StartCoroutine(OneshotLoop(twig, 5f, 15f, 0.05f, 0.15f, 0.9f, 1.2f, go => {
                AddWalkMovement(go.transform, -5f, 5f, -5f, 5f, 0.5f);
            }));

        // 4 fireflies: volume 0.02-0.08, pitch 1.5-2.5, fly, sphere, animated color
        for (int i = 0; i < 4; i++)
            StartCoroutine(OneshotLoop(firefly, 2f, 6f, 0.02f, 0.08f, 1.5f, 2.5f, go => {
                AddFlyMovement(go.transform, new Vector3(-5, -5, -5), new Vector3(5, 5, 5),
                    Random.Range(0.5f, 1f));
                var sphere = AddSphere(go);
                StartCoroutine(AnimateFireflyColor(sphere.GetComponent<Renderer>()));
            }));

        // 1 owl: volume 0.3-0.5, pitch 0.8-1, reverb, xyz movement
        StartCoroutine(OneshotLoop(owl, 15f, 30f, 0.3f, 0.5f, 0.8f, 1f, go => {
            var reverb = go.AddComponent<AudioReverbFilter>();
            reverb.reverbLevel = 0; // wet ~0.7
            reverb.decayTime = 3f; // size ~0.9
            AddFlyMovement(go.transform, new Vector3(-15, 8, -15), new Vector3(15, 12, 15), 1f);
        }));

        // Creek loop with delay
        var creekSrc = MakeSrc(creek, true, 0.15f);
        var echo = creekSrc.gameObject.AddComponent<AudioEchoFilter>();
        echo.delay = 200f; // 0.2s in ms
        echo.wetMix = 0.3f;
        echo.decayRatio = 0.4f;
        creekSrc.Play();
    }

    AudioSource MakeSrc(AudioClip clip, bool loop, float vol, float pitch = 1f)
    {
        var go = new GameObject($"[Snd] {clip.name}");
        go.transform.SetParent(transform);
        var src = go.AddComponent<AudioSource>();
        src.clip = clip;
        src.loop = loop;
        src.volume = vol * groupVol;
        src.pitch = pitch;
        src.spatialBlend = 1f;
        src.spatialize = true;
        src.rolloffMode = AudioRolloffMode.Logarithmic;
        src.minDistance = 1f;
        src.maxDistance = 100f;
        return src;
    }

    IEnumerator GroupFadeIn(float dur)
    {
        groupVol = 0f;
        for (float t = 0; t < dur; t += Time.deltaTime)
        {
            float n = t / dur;
            groupVol = n * n;
            yield return null;
        }
        groupVol = 1f;
    }

    IEnumerator OneshotLoop(AudioClip clip, float minEvery, float maxEvery,
        float minVol, float maxVol, float minPitch, float maxPitch,
        System.Action<GameObject> setup)
    {
        while (true)
        {
            yield return new WaitForSeconds(Random.Range(minEvery, maxEvery));
            var src = MakeSrc(clip, false, Random.Range(minVol, maxVol),
                Random.Range(minPitch, maxPitch));
            setup?.Invoke(src.gameObject);
            src.Play();
            Destroy(src.gameObject, clip.length + 1f);
        }
    }

    IEnumerator OscillateFilter(AudioLowPassFilter lpf, float min, float max, float period)
    {
        while (lpf != null)
        {
            float t = Mathf.PingPong(Time.time / period, 1f);
            lpf.cutoffFrequency = Mathf.Lerp(min, max, t);
            yield return null;
        }
    }

    IEnumerator AnimateFireflyColor(Renderer rend)
    {
        var mpb = new MaterialPropertyBlock();
        while (rend != null)
        {
            float g = Mathf.Lerp(100f / 255f, 1f, Mathf.PingPong(Time.time / 3f, 1f));
            mpb.SetColor("_Color", new Color(50f / 255f, g, 0f));
            rend.SetPropertyBlock(mpb);
            yield return null;
        }
    }

    void AddWalkMovement(Transform t, float xMin, float xMax, float zMin, float zMax, float speed)
    {
        StartCoroutine(PerlinMove(t, new Vector3(xMin, 0, zMin), new Vector3(xMax, 0, zMax), speed));
    }

    void AddFlyMovement(Transform t, Vector3 min, Vector3 max, float speed)
    {
        StartCoroutine(PerlinMove(t, min, max, speed));
    }

    IEnumerator PerlinMove(Transform t, Vector3 min, Vector3 max, float speed)
    {
        float ox = Random.Range(0f, 1000f), oy = Random.Range(0f, 1000f), oz = Random.Range(0f, 1000f);
        while (t != null)
        {
            float time = Time.time * speed;
            float px = Mathf.PerlinNoise(time + ox, 0f);
            float py = Mathf.PerlinNoise(time + oy, 0f);
            float pz = Mathf.PerlinNoise(time + oz, 0f);
            t.localPosition = new Vector3(
                Mathf.Lerp(min.x, max.x, px),
                Mathf.Lerp(min.y, max.y, py),
                Mathf.Lerp(min.z, max.z, pz));
            yield return null;
        }
    }

    void AddTrail(GameObject go, Color color)
    {
        var trail = go.AddComponent<TrailRenderer>();
        trail.time = 2f;
        trail.startWidth = 0.1f;
        trail.endWidth = 0f;
        trail.material = new Material(Shader.Find("Sprites/Default"));
        trail.startColor = color;
        trail.endColor = new Color(color.r, color.g, color.b, 0f);
    }

    GameObject AddSphere(GameObject go)
    {
        var sphere = GameObject.CreatePrimitive(PrimitiveType.Sphere);
        sphere.transform.SetParent(go.transform);
        sphere.transform.localPosition = Vector3.zero;
        sphere.transform.localScale = Vector3.one * 0.2f;
        Destroy(sphere.GetComponent<Collider>());
        return sphere;
    }
}
