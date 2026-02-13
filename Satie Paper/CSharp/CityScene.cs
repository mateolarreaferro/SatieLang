using UnityEngine;
using System.Collections;

public class CityScene : MonoBehaviour
{
    public AudioClip traffic, horn, footstep, jackhammer, siren;
    float groupVol;

    void Start()
    {
        StartCoroutine(GroupFadeIn(3f));

        // Traffic ambience loop with lowpass filter
        var trafficSrc = MakeSrc(traffic, true, 0.4f);
        var lpf = trafficSrc.gameObject.AddComponent<AudioLowPassFilter>();
        lpf.cutoffFrequency = 4000f;
        trafficSrc.Play();

        // 3 car horns: volume 0.2-0.5, pitch 0.8-1.2, x movement
        for (int i = 0; i < 3; i++)
            StartCoroutine(OneshotLoop(horn, 8f, 20f, 0.2f, 0.5f, 0.8f, 1.2f, go => {
                StartCoroutine(PerlinMove(go.transform,
                    new Vector3(-20, 0, -5), new Vector3(20, 0, 5), Random.Range(4f, 8f)));
            }));

        // 5 footsteps: volume 0.05-0.15, pitch 0.9-1.1, walk, sphere
        for (int i = 0; i < 5; i++)
            StartCoroutine(OneshotLoop(footstep, 0.5f, 2f, 0.05f, 0.15f, 0.9f, 1.1f, go => {
                StartCoroutine(PerlinMove(go.transform,
                    new Vector3(-5, 0, -5), new Vector3(5, 0, 5), Random.Range(1f, 2f)));
                AddSphere(go);
            }));

        // 2 jackhammers: volume 0.3-0.5, pitch 0.9-1, fixed position area, lowpass + reverb
        for (int i = 0; i < 2; i++)
            StartCoroutine(OneshotLoop(jackhammer, 12f, 25f, 0.3f, 0.5f, 0.9f, 1f, go => {
                StartCoroutine(PerlinMove(go.transform,
                    new Vector3(15, 0, 10), new Vector3(20, 0, 15), 1f));
                go.AddComponent<AudioLowPassFilter>().cutoffFrequency = 2000f;
                var reverb = go.AddComponent<AudioReverbFilter>();
                reverb.reverbLevel = -1200; // wet ~0.3
                reverb.decayTime = 1.5f; // size ~0.4
            }));

        // 1 siren: animated volume + oscillating pitch, x movement, trail, red
        StartCoroutine(SirenLoop());
    }

    IEnumerator SirenLoop()
    {
        while (true)
        {
            yield return new WaitForSeconds(Random.Range(30f, 60f));
            var src = MakeSrc(siren, false, 0.1f);
            var go = src.gameObject;
            AddTrail(go, Color.red);
            StartCoroutine(PerlinMove(go.transform,
                new Vector3(-30, 0, 0), new Vector3(30, 0, 0), 6f));
            StartCoroutine(LerpVolume(src, 0.1f, 0.8f, 3f));
            StartCoroutine(OscillatePitch(src, 0.8f, 1.3f, 2f));
            src.Play();
            Destroy(go, siren.length + 1f);
        }
    }

    IEnumerator LerpVolume(AudioSource src, float from, float to, float dur)
    {
        for (float t = 0; t < dur && src != null; t += Time.deltaTime)
        {
            src.volume = Mathf.Lerp(from, to, t / dur) * groupVol;
            yield return null;
        }
        if (src != null) src.volume = to * groupVol;
    }

    IEnumerator OscillatePitch(AudioSource src, float min, float max, float period)
    {
        while (src != null)
        {
            src.pitch = Mathf.Lerp(min, max, Mathf.PingPong(Time.time / period, 1f));
            yield return null;
        }
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

    void AddSphere(GameObject go)
    {
        var sphere = GameObject.CreatePrimitive(PrimitiveType.Sphere);
        sphere.transform.SetParent(go.transform);
        sphere.transform.localPosition = Vector3.zero;
        sphere.transform.localScale = Vector3.one * 0.3f;
        Destroy(sphere.GetComponent<Collider>());
    }
}
