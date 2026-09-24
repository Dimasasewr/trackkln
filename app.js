(() => {
  const CFG = window.KARSA_CONFIG || {};
  const hasSupabase = Boolean(
    CFG.SUPABASE_URL &&
    CFG.SUPABASE_KEY &&
    window.supabase
  );

  const client = hasSupabase
    ? window.supabase.createClient(
        CFG.SUPABASE_URL,
        CFG.SUPABASE_KEY
      )
    : null;

  let state = {
    user: null,
    jobs: [],
    activities: [],
    currentView: "dashboard",
    filterText: "",
    filterStatus: "",
    filterDivision: ""
  };

  const $ = id => document.getElementById(id);

  const today = () =>
    new Date().toISOString().slice(0, 10);

  const esc = s =>
    String(s ?? "").replace(
      /[&<>"']/g,
      m =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#039;"
        })[m]
    );

  const initials = name =>
    String(name || "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(x => x[0])
      .join("")
      .toUpperCase() || "K";

  const roleLabel = role =>
    ({
      director: "Director",
      general_manager: "General Manager",
      operational_head: "Head Divisi Operasional",
      division_head: "Head Divisi",
      staff: "Staff"
    })[role] || role;

  const dateFmt = d =>
    d
      ? new Intl.DateTimeFormat("id-ID", {
          day: "2-digit",
          month: "short",
          year: "numeric"
        }).format(new Date(d + "T00:00:00"))
      : "—";

  const statusClass = s =>
    s === "Selesai"
      ? "done"
      : s === "Terkendala"
      ? "blocked"
      : s === "Siap Review"
      ? "review"
      : s === "Menunggu"
      ? "wait"
      : "";

  /*
   * =========================================================
   * HAK AKSES
   * =========================================================
   *
   * Director:
   * - Bisa memberikan jobdesk
   * - Bisa melihat seluruh pekerjaan
   *
   * General Manager:
   * - Bisa memberikan jobdesk
   * - Bisa melihat seluruh pekerjaan
   *
   * Head Divisi Operasional:
   * - Bisa memberikan jobdesk
   * - Bisa melihat seluruh pekerjaan
   *
   * Head Divisi / Staff:
   * - Hanya melihat pekerjaan divisinya
   *
   * Update progres:
   * - HANYA PIC yang ditunjuk
   */

  const canAssign = () =>
    [
      "director",
      "general_manager",
      "operational_head"
    ].includes(state.user?.role);

  const canMonitorAll = () =>
    [
      "director",
      "general_manager",
      "operational_head"
    ].includes(state.user?.role);

  const canEditProgress = job =>
    Boolean(
      state.user &&
      job.assigneeId === state.user.id
    );

  function canSee(job) {
    if (!state.user) return false;

    if (canMonitorAll()) {
      return true;
    }

    return (
      job.division ===
      state.user.division
    );
  }

  function visibleJobs() {
    return state.jobs.filter(canSee);
  }

  /*
   * =========================================================
   * LOAD JOBS
   * =========================================================
   */

  async function loadJobs() {
    if (client) {
      const {
        data,
        error
      } = await client
        .from("jobs")
        .select("*")
        .order("updated_at", {
          ascending: false
        });

      if (!error && data) {
        state.jobs = data.map(normalizeJob);
      } else {
        state.jobs = [];

        showToast(
          "Database belum terhubung atau tabel jobs belum dibuat."
        );
      }
    } else {
      state.jobs = JSON.parse(
        localStorage.getItem(
          "karsa_jobs"
        ) || "[]"
      );
    }
  }

  function normalizeJob(j) {
    return {
      id: j.id,

      title: j.title,

      division:
        j.assigned_division ||
        j.division,

      assigneeId:
        j.assignee_id ||
        j.assigneeId ||
        "",

      assignee:
        j.assignee_name ||
        j.assignee ||
        "",

      deadline: j.deadline,

      progress: Number(
        j.progress || 0
      ),

      status:
        j.status ||
        "Belum Mulai",

      priority:
        j.priority ||
        "Normal",

      description:
        j.description ||
        "",

      blocker:
        j.blocker ||
        "",

      nextAction:
        j.next_action ||
        j.nextAction ||
        "",

      createdBy:
        j.created_by ||
        "",

      updated:
        j.updated_at
          ? new Date(
              j.updated_at
            ).toLocaleString(
              "id-ID",
              {
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit"
              }
            )
          : "—"
    };
  }

  /*
   * =========================================================
   * UPDATE JOB
   * =========================================================
   */

  async function updateJob(
    job,
    patch
  ) {
    if (!canEditProgress(job)) {
      showToast(
        "Hanya PIC yang dipilih untuk pekerjaan ini yang dapat memperbarui progres."
      );

      return false;
    }

    const next = {
      ...job,
      ...patch
    };

    if (
      Number(next.progress) >= 100 &&
      next.status === "In Progress"
    ) {
      next.status =
        "Siap Review";
    }

    if (client) {
      const payload = {
        progress: next.progress,
        status: next.status,
        blocker: next.blocker,
        next_action:
          next.nextAction
      };

      const {
        data,
        error
      } = await client
        .from("jobs")
        .update(payload)
        .eq("id", job.id)
        .eq(
          "assignee_id",
          state.user.id
        )
        .select("*")
        .single();

      if (error) {
        showToast(
          error.message
        );

        return false;
      }

      const idx =
        state.jobs.findIndex(
          x =>
            x.id === job.id
        );

      if (idx >= 0) {
        state.jobs[idx] =
          normalizeJob(data);
      }

      await client
        .from(
          "progress_history"
        )
        .insert({
          job_id: job.id,
          progress:
            next.progress,
          status:
            next.status,
          note:
            next.nextAction ||
            next.blocker ||
            "",
          updated_by:
            state.user.id
        });
    } else {
      const idx =
        state.jobs.findIndex(
          x =>
            x.id === job.id
        );

      if (idx >= 0) {
        state.jobs[idx] =
          next;
      }

      localStorage.setItem(
        "karsa_jobs",
        JSON.stringify(
          state.jobs
        )
      );
    }

    addActivity(
      `${state.user.name} memperbarui "${next.title}"`,
      `${next.progress}% • ${next.status}`
    );

    renderAll();

    return true;
  }

  /*
   * =========================================================
   * CREATE JOB
   * =========================================================
   */

  async function createJob(data) {
    if (!canAssign()) {
      showToast(
        "Hanya Director / General Manager / Head Divisi Operasional yang dapat memberikan pekerjaan."
      );

      return false;
    }

    if (
      !data.title ||
      !data.assigneeId ||
      !data.division ||
      !data.deadline
    ) {
      showToast(
        "Lengkapi nama pekerjaan, divisi, PIC, dan deadline."
      );

      return false;
    }

    const newJob = {
      id:
        "KRS-" +
        Date.now(),

      title:
        data.title,

      division:
        data.division,

      assigneeId:
        data.assigneeId,

      assignee:
        data.assignee,

      deadline:
        data.deadline,

      progress: 0,

      status:
        "Belum Mulai",

      priority:
        data.priority,

      description:
        data.description,

      blocker: "",

      nextAction:
        data.nextAction,

      updated:
        "Baru"
    };

    if (client) {
      const {
        data: row,
        error
      } = await client
        .from("jobs")
        .insert({
          title:
            newJob.title,

          assigned_division:
            newJob.division,

          assignee_id:
            newJob.assigneeId,

          assignee_name:
            newJob.assignee,

          deadline:
            newJob.deadline,

          progress: 0,

          status:
            newJob.status,

          priority:
            newJob.priority,

          description:
            newJob.description,

          next_action:
            newJob.nextAction,

          created_by:
            state.user.id
        })
        .select("*")
        .single();

      if (error) {
        showToast(
          error.message
        );

        return false;
      }

      state.jobs.unshift(
        normalizeJob(row)
      );
    } else {
      state.jobs.unshift(
        newJob
      );

      localStorage.setItem(
        "karsa_jobs",
        JSON.stringify(
          state.jobs
        )
      );
    }

    addActivity(
      `Assignment dikirim ke ${newJob.division}`,
      `${newJob.title} → ${newJob.assignee}`
    );

    showToast(
      `Pekerjaan masuk ke ${newJob.division} • PIC: ${newJob.assignee}`
    );

    return true;
  }

  /*
   * =========================================================
   * ACTIVITY
   * =========================================================
   */

  function addActivity(
    title,
    detail
  ) {
    state.activities.unshift({
      title,
      detail,
      time: "Baru"
    });

    state.activities =
      state.activities.slice(
        0,
        8
      );

    localStorage.setItem(
      "karsa_demo_activity",
      JSON.stringify(
        state.activities
      )
    );
  }

  function loadActivities() {
    state.activities =
      JSON.parse(
        localStorage.getItem(
          "karsa_demo_activity"
        ) || "[]"
      );

    if (
      !state.activities.length
    ) {
      state.activities = [
        {
          title:
            "Workspace initialized",

          detail:
            "KARSA Executive Work Tracker",

          time:
            "Hari ini"
        },

        {
          title:
            "Routing aktif",

          detail:
            "Assignment → divisi tujuan",

          time:
            "Hari ini"
        }
      ];
    }
  }

  /*
   * =========================================================
   * RENDER
   * =========================================================
   */

  function renderAll() {
    renderUser();
    renderDashboard();
    renderJobs();
    renderMyJobs();
    renderWeekly();
    renderActivity();
  }

  function renderUser() {
    const u =
      state.user;

    if (!u) return;

    $("sideName").textContent =
      u.name;

    $("sideRole").textContent =
      `${roleLabel(u.role)} • ${u.division}`;

    const avatarText =
      u.initials ||
      initials(u.name);

    [$("sideAvatar"), $("mobileAvatar")]
      .filter(Boolean)
      .forEach(el => {
        el.textContent = avatarText;
        el.style.backgroundImage = u.avatarUrl
          ? `url("${u.avatarUrl}")`
          : "";
        el.style.backgroundSize = "cover";
        el.style.backgroundPosition = "center";
        el.style.backgroundRepeat = "no-repeat";
        el.style.color = u.avatarUrl ? "transparent" : "";
      });

    $("welcomeText").textContent =
      `${u.title || roleLabel(u.role)} • ${u.division}. Pantau pekerjaan yang berjalan dan pastikan next action selalu jelas.`;

    document
      .querySelectorAll(
        ".ops-only"
      )
      .forEach(el => {
        el.classList.toggle(
          "hidden",
          !canAssign()
        );
      });

    $("connectionText").textContent =
      client
        ? "Supabase connected"
        : "Preview mode";
  }

  /*
   * =========================================================
   * DASHBOARD
   * =========================================================
   */

  function renderDashboard() {
    const jobs =
      visibleJobs();

    const total =
      jobs.length;

    const progress =
      jobs.filter(
        j =>
          j.status ===
          "In Progress"
      ).length;

    const review =
      jobs.filter(
        j =>
          j.status ===
          "Siap Review"
      ).length;

    const blocked =
      jobs.filter(
        j =>
          j.status ===
          "Terkendala"
      ).length;

    const late =
      jobs.filter(
        j =>
          j.deadline &&
          j.deadline <
            today() &&
          j.status !==
            "Selesai"
      ).length;

    $("statTotal").textContent =
      total;

    $("statProgress").textContent =
      progress;

    $("statReview").textContent =
      review;

    $("statBlocked").textContent =
      blocked;

    $("statLate").textContent =
      late;

    const avg =
      total
        ? Math.round(
            jobs.reduce(
              (a, j) =>
                a +
                j.progress,
              0
            ) / total
          )
        : 0;

    $("heroProgress").textContent =
      avg + "%";

    const attention =
      jobs
        .filter(
          j =>
            j.status ===
              "Terkendala" ||
            (
              j.deadline <
                today() &&
              j.status !==
                "Selesai"
            ) ||
            j.status ===
              "Siap Review"
        )
        .slice(0, 5);

    $("attentionList").innerHTML =
      attention.length
        ? attention
            .map(
              j =>
                `<div class="attention-item">
                  <span class="bar ${
                    j.status ===
                    "Terkendala"
                      ? "red"
                      : ""
                  }"></span>
                  <div>
                    <strong>${esc(
                      j.title
                    )}</strong>
                    <small>
                      ${esc(
                        j.division
                      )} •
                      ${esc(
                        j.assignee
                      )} •
                      ${dateFmt(
                        j.deadline
                      )}
                    </small>
                  </div>
                  <span class="pct">
                    ${j.progress}%
                  </span>
                </div>`
            )
            .join("")
        : `<div class="empty">
            <div>✓</div>
            <h3>Tidak ada item kritis</h3>
            <p>
              Semua pekerjaan terlihat terkendali dari akun ini.
            </p>
          </div>`;

    const divisions = [
      "Finance",
      "IT",
      "Operasional",
      "R&D"
    ];

    $("divisionPulse").innerHTML =
      divisions
        .map(d => {
          const a =
            jobs.filter(
              j =>
                j.division ===
                d
            );

          const p =
            a.length
              ? Math.round(
                  a.reduce(
                    (x, j) =>
                      x +
                      j.progress,
                    0
                  ) /
                    a.length
                )
              : 0;

          return `
            <div class="division-row">
              <div class="division-label">
                <span>${d}</span>
                <span>
                  ${a.length} job • ${p}%
                </span>
              </div>

              <div class="division-track">
                <span
                  style="width:${p}%"
                ></span>
              </div>
            </div>
          `;
        })
        .join("");
  }

  /*
   * =========================================================
   * FILTER
   * =========================================================
   */

  function filteredJobs() {
    const q =
      state.filterText
        .toLowerCase();

    return visibleJobs().filter(
      j =>
        (
          !q ||
          `${j.title} ${j.assignee} ${j.division}`
            .toLowerCase()
            .includes(q)
        ) &&
        (
          !state.filterStatus ||
          j.status ===
            state.filterStatus
        ) &&
        (
          !state.filterDivision ||
          j.division ===
            state.filterDivision
        )
    );
  }

  /*
   * =========================================================
   * JOB TABLE
   * =========================================================
   */

  function renderJobs() {
    const jobs =
      filteredJobs();

    $("jobRows").innerHTML =
      jobs
        .map(
          j =>
            `<tr>
              <td>
                <strong>${esc(
                  j.title
                )}</strong>
                <small>
                  ${esc(
                    j.description
                  ).slice(
                    0,
                    80
                  )}
                </small>
              </td>

              <td>
                <strong>${esc(
                  j.division
                )}</strong>
                <small>
                  ${esc(
                    j.assignee
                  )}
                </small>
              </td>

              <td>
                ${dateFmt(
                  j.deadline
                )}

                ${
                  j.deadline <
                    today() &&
                  j.status !==
                    "Selesai"
                    ? `<small style="color:#d87979">
                        Lewat deadline
                      </small>`
                    : ""
                }
              </td>

              <td class="progress-cell">
                <div class="progress-top">
                  <span>
                    PROGRESS
                  </span>

                  <b>
                    ${j.progress}%
                  </b>
                </div>

                <div class="progress-track">
                  <span
                    style="width:${j.progress}%"
                  ></span>
                </div>
              </td>

              <td>
                <span class="status ${statusClass(
                  j.status
                )}">
                  ${esc(
                    j.status
                  )}
                </span>
              </td>

              <td>
                <button
                  class="row-action"
                  data-open-job="${j.id}"
                >
                  Buka
                </button>
              </td>
            </tr>`
        )
        .join("");

    $("jobEmpty").classList.toggle(
      "hidden",
      jobs.length > 0
    );
  }

  /*
   * =========================================================
   * MY JOBS
   * =========================================================
   */

  function renderMyJobs() {
    const jobs =
      visibleJobs().filter(
        j =>
          j.assigneeId ===
          state.user.id
      );

    $("myJobsGrid").innerHTML =
      jobs.length
        ? jobs
            .map(
              j =>
                `<article class="job-card">

                  <div class="card-meta">
                    <span class="status ${statusClass(
                      j.status
                    )}">
                      ${esc(
                        j.status
                      )}
                    </span>

                    <small style="color:#777">
                      ${esc(
                        j.priority
                      )}
                    </small>
                  </div>

                  <h3>
                    ${esc(
                      j.title
                    )}
                  </h3>

                  <p>
                    ${esc(
                      j.description ||
                        "Tidak ada deskripsi."
                    )}
                  </p>

                  <div class="deadline">
                    DEADLINE •
                    ${dateFmt(
                      j.deadline
                    )}
                  </div>

                  <div class="progress-top">
                    <span>
                      PROGRESS
                    </span>

                    <b>
                      ${j.progress}%
                    </b>
                  </div>

                  <div class="progress-track">
                    <span
                      style="width:${j.progress}%"
                    ></span>
                  </div>

                  <div class="next">
                    <b>
                      Next action
                    </b>

                    ${esc(
                      j.nextAction ||
                        "Belum ditentukan"
                    )}
                  </div>

                  <div class="card-bottom">

                    <small style="color:#666">
                      ${esc(
                        j.division
                      )}
                    </small>

                    <button
                      class="row-action"
                      data-open-job="${j.id}"
                    >
                      Update →
                    </button>

                  </div>

                </article>`
            )
            .join("")
        : `<div
            class="empty"
            style="grid-column:1/-1"
          >
            <div>◇</div>

            <h3>
              Queue kosong
            </h3>

            <p>
              Tidak ada pekerjaan yang ditugaskan ke akun ini.
            </p>
          </div>`;
  }

  /*
   * =========================================================
   * WEEKLY
   * =========================================================
   */

  function renderWeekly() {
    const jobs =
      visibleJobs();

    const avg =
      jobs.length
        ? Math.round(
            jobs.reduce(
              (a, j) =>
                a +
                j.progress,
              0
            ) /
              jobs.length
          )
        : 0;

    $("weeklyPercent").textContent =
      avg + "%";

    const counts = [
      "Belum Mulai",
      "In Progress",
      "Menunggu",
      "Terkendala",
      "Siap Review",
      "Selesai"
    ].map(
      s => [
        s,
        jobs.filter(
          j =>
            j.status === s
        ).length
      ]
    );

    $("weeklyStatus").innerHTML =
      counts
        .map(
          ([s, n]) =>
            `<div class="summary-line">
              <span>${s}</span>
              <span>${n}</span>
            </div>`
        )
        .join("");

    const follow =
      jobs
        .filter(
          j =>
            j.status ===
              "Terkendala" ||
            j.status ===
              "Siap Review" ||
            j.deadline <
              today()
        )
        .slice(0, 7);

    $("weeklyFollowup").innerHTML =
      follow.length
        ? follow
            .map(
              j =>
                `<div class="follow-item">
                  <strong>
                    ${esc(
                      j.title
                    )}
                  </strong>

                  <small>
                    ${esc(
                      j.division
                    )} •
                    ${esc(
                      j.status
                    )} •
                    ${esc(
                      j.nextAction ||
                        j.blocker ||
                        "Follow-up diperlukan"
                    )}
                  </small>
                </div>`
            )
            .join("")
        : `<div class="empty">
            <div>✓</div>
            <h3>
              Belum ada follow-up
            </h3>
          </div>`;

    const bars = [
      ["M", 0.55],
      ["T", 0.68],
      ["W", 0.72],
      ["T", 0.77],
      ["F", avg / 100],
      ["S", 0.35],
      ["M", 0.22]
    ];

    $("weekBars").innerHTML =
      bars
        .map(
          ([d, p]) =>
            `<div class="week-bar">
              <span
                style="height:${Math.max(
                  8,
                  p * 100
                )}px"
              ></span>

              <small>
                ${d}
              </small>
            </div>`
        )
        .join("");
  }

  /*
   * =========================================================
   * ACTIVITY
   * =========================================================
   */

  function renderActivity() {
    $("activityList").innerHTML =
      state.activities
        .map(
          a =>
            `<div class="activity-item">

              <div class="activity-icon">
                ✦
              </div>

              <div>
                <strong>
                  ${esc(
                    a.title
                  )}
                </strong>

                <small>
                  ${esc(
                    a.detail
                  )}
                </small>
              </div>

              <span class="activity-time">
                ${esc(
                  a.time
                )}
              </span>

            </div>`
        )
        .join("");
  }

  /*
   * =========================================================
   * VIEW
   * =========================================================
   */

  function showView(view) {
    state.currentView =
      view;

    document
      .querySelectorAll(
        ".view"
      )
      .forEach(v =>
        v.classList.remove(
          "active"
        )
      );

    $("view-" + view)
      ?.classList.add(
        "active"
      );

    document
      .querySelectorAll(
        ".nav-item"
      )
      .forEach(n =>
        n.classList.toggle(
          "active",
          n.dataset.view ===
            view
        )
      );

    const titles = {
      dashboard: [
        "EXECUTIVE WORKSPACE",
        "Overview"
      ],

      jobs: [
        "WORK REGISTER",
        "Pekerjaan"
      ],

      myjobs: [
        "PERSONAL QUEUE",
        "Pekerjaan Saya"
      ],

      create: [
        "ASSIGNMENT DESK",
        "Berikan Pekerjaan"
      ],

      weekly: [
        "WEEKLY REVIEW",
        "Evaluasi Mingguan"
      ],

      structure: [
        "ORGANIZATION",
        "Struktur Akses"
      ]
    };

    $("pageEyebrow").textContent =
      titles[view]?.[0] ||
      "KARSA";

    $("pageTitle").textContent =
      titles[view]?.[1] ||
      "Workspace";

    $("sidebar").classList.remove("open");
    $("sidebarBackdrop")?.classList.remove("show");
  }

  /*
   * =========================================================
   * JOB MODAL
   * =========================================================
   */

  function openJob(jobId) {
    const j =
      state.jobs.find(
        x =>
          x.id === jobId
      );

    if (!j) return;

    const editable =
      canEditProgress(j);

    $("modalTitle").textContent =
      j.title;

    $("modalBody").innerHTML = `
      <div class="update-info">

        <strong>
          ${esc(
            j.division
          )} •
          ${esc(
            j.assignee
          )}
        </strong>

        <small>
          Deadline
          ${dateFmt(
            j.deadline
          )}
          • Prioritas
          ${esc(
            j.priority
          )}
        </small>

      </div>

      <div class="update-grid">

        <label>
          Progress (%)

          <input
            id="uProgress"
            type="number"
            min="0"
            max="100"
            value="${j.progress}"
            ${
              editable
                ? ""
                : "disabled"
            }
          >
        </label>

        <label>
          Status

          <select
            id="uStatus"
            ${
              editable
                ? ""
                : "disabled"
            }
          >

            ${
              [
                "Belum Mulai",
                "In Progress",
                "Menunggu",
                "Terkendala",
                "Siap Review",
                "Selesai"
              ]
                .map(
                  s =>
                    `<option ${
                      s ===
                      j.status
                        ? "selected"
                        : ""
                    }>
                      ${s}
                    </option>`
                )
                .join("")
            }

          </select>
        </label>

        <label class="wide">
          Kendala

          <textarea
            id="uBlocker"
            rows="3"
            ${
              editable
                ? ""
                : "disabled"
            }
          >${esc(
            j.blocker
          )}</textarea>
        </label>

        <label class="wide">
          Next action / kebutuhan follow-up

          <textarea
            id="uNext"
            rows="3"
            ${
              editable
                ? ""
                : "disabled"
            }
          >${esc(
            j.nextAction
          )}</textarea>
        </label>

      </div>

      <div class="form-actions">

        <button
          class="btn-ghost"
          data-close-modal
        >
          Tutup
        </button>

        ${
          editable
            ? `<button
                id="saveUpdate"
                class="btn-gold"
              >
                Simpan update →
              </button>`
            : ""
        }

      </div>
    `;

    $("jobModal").classList.remove(
      "hidden"
    );

    $("saveUpdate")
      ?.addEventListener(
        "click",
        async () => {
          const ok =
            await updateJob(
              j,
              {
                progress:
                  Number(
                    $(
                      "uProgress"
                    ).value
                  ),

                status:
                  $(
                    "uStatus"
                  ).value,

                blocker:
                  $(
                    "uBlocker"
                  ).value,

                nextAction:
                  $(
                    "uNext"
                  ).value
              }
            );

          if (ok) {
            closeModal();

            showToast(
              "Update tersimpan."
            );
          }
        }
      );
  }

  function closeModal() {
    $("jobModal").classList.add(
      "hidden"
    );
  }

  /*
   * =========================================================
   * PROFILE
   * =========================================================
   */

  const AVATAR_BUCKET = "avatars";

  function avatarPathFromUrl(url) {
    if (!url) return "";

    const marker =
      `/storage/v1/object/public/${AVATAR_BUCKET}/`;

    const index = url.indexOf(marker);
    if (index === -1) return "";

    return decodeURIComponent(
      url.slice(index + marker.length).split("?")[0]
    );
  }

  function ensureProfileUI() {
    if ($("karsaProfileStyle")) return;

    const style = document.createElement("style");
    style.id = "karsaProfileStyle";
    style.textContent = `
      .karsa-profile-trigger { cursor:pointer !important; }
      .karsa-profile-modal {
        position:fixed; inset:0; z-index:9999;
        display:flex; align-items:center; justify-content:center;
        padding:20px; background:rgba(8,8,8,.62);
        backdrop-filter:blur(12px);
      }
      .karsa-profile-modal.hidden { display:none; }
      .karsa-profile-card {
        width:min(460px,100%); background:#fff; color:#111;
        border-radius:24px; padding:28px; box-shadow:0 30px 80px rgba(0,0,0,.28);
        animation:karsaProfileIn .24s ease both;
      }
      @keyframes karsaProfileIn { from{opacity:0;transform:translateY(12px) scale(.98)} to{opacity:1;transform:none} }
      .karsa-profile-head { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; margin-bottom:24px; }
      .karsa-profile-head small { display:block; color:#9a7a3b; letter-spacing:.16em; font-size:10px; font-weight:800; margin-bottom:5px; }
      .karsa-profile-head h2 { margin:0; font-size:24px; }
      .karsa-profile-close { border:0; background:#f3f3f1; width:36px; height:36px; border-radius:50%; cursor:pointer; font-size:20px; }
      .karsa-profile-avatar-wrap { display:flex; justify-content:center; margin:4px 0 22px; }
      .karsa-profile-avatar { width:108px; height:108px; border-radius:50%; display:flex; align-items:center; justify-content:center; background:#111; color:#fff; font-size:30px; font-weight:700; background-size:cover; background-position:center; border:4px solid #fff; box-shadow:0 10px 30px rgba(0,0,0,.15); }
      .karsa-profile-actions { display:flex; justify-content:center; gap:10px; margin-bottom:24px; flex-wrap:wrap; }
      .karsa-profile-btn { border:1px solid #ddd; background:#fff; padding:10px 14px; border-radius:12px; cursor:pointer; font-weight:700; }
      .karsa-profile-btn.gold { background:#c9a45c; border-color:#c9a45c; color:#fff; }
      .karsa-profile-btn.danger { color:#b54b4b; }
      .karsa-profile-field { margin-top:14px; }
      .karsa-profile-field label { display:block; font-size:11px; font-weight:800; letter-spacing:.08em; margin-bottom:7px; color:#555; }
      .karsa-profile-field input { width:100%; box-sizing:border-box; border:1px solid #ddd; border-radius:12px; padding:12px 13px; font:inherit; outline:none; }
      .karsa-profile-field input:focus { border-color:#c9a45c; box-shadow:0 0 0 3px rgba(201,164,92,.12); }
      .karsa-profile-meta { margin-top:18px; padding:14px; background:#f7f7f5; border-radius:14px; }
      .karsa-profile-meta div { display:flex; justify-content:space-between; gap:16px; padding:5px 0; font-size:12px; }
      .karsa-profile-meta span:first-child { color:#777; }
      .karsa-profile-footer { display:flex; justify-content:flex-end; gap:10px; margin-top:22px; }
      .karsa-profile-note { font-size:11px; color:#888; text-align:center; margin-top:10px; }
      .karsa-crop-modal { position:fixed; inset:0; z-index:10001; display:flex; align-items:center; justify-content:center; padding:16px; background:rgba(5,5,5,.78); backdrop-filter:blur(14px); }
      .karsa-crop-modal.hidden { display:none; }
      .karsa-crop-card { width:min(520px,100%); background:#fff; color:#111; border-radius:24px; padding:20px; box-shadow:0 30px 90px rgba(0,0,0,.4); }
      .karsa-crop-head { display:flex; align-items:flex-start; justify-content:space-between; gap:14px; margin-bottom:14px; }
      .karsa-crop-head small { display:block; color:#9a7a3b; letter-spacing:.15em; font-size:10px; font-weight:800; margin-bottom:4px; }
      .karsa-crop-head h3 { margin:0; font-size:20px; }
      .karsa-crop-stage { width:min(390px,82vw); aspect-ratio:1; margin:0 auto; overflow:hidden; border-radius:20px; background:#111; position:relative; touch-action:none; cursor:grab; box-shadow:inset 0 0 0 1px rgba(255,255,255,.08); }
      .karsa-crop-stage.dragging { cursor:grabbing; }
      #karsaCropCanvas { width:100%; height:100%; display:block; }
      .karsa-crop-guide { pointer-events:none; position:absolute; inset:0; border-radius:20px; box-shadow:inset 0 0 0 1px rgba(255,255,255,.35); }
      .karsa-crop-guide:before, .karsa-crop-guide:after { content:""; position:absolute; background:rgba(255,255,255,.18); }
      .karsa-crop-guide:before { width:1px; height:100%; left:33.333%; box-shadow:calc(33.333% + 1px) 0 0 rgba(255,255,255,.18); }
      .karsa-crop-guide:after { height:1px; width:100%; top:33.333%; box-shadow:0 calc(33.333% + 1px) 0 rgba(255,255,255,.18); }
      .karsa-crop-tools { display:flex; align-items:center; gap:10px; margin-top:16px; }
      .karsa-crop-tools button { width:42px; height:38px; border:1px solid #ddd; background:#fff; border-radius:11px; cursor:pointer; font-size:18px; font-weight:800; }
      #karsaCropZoom { flex:1; accent-color:#c9a45c; }
      .karsa-crop-help { text-align:center; color:#777; font-size:11px; margin:10px 0 16px; }
      .karsa-crop-footer { display:flex; justify-content:flex-end; gap:10px; }
      .karsa-crop-footer button { border:1px solid #ddd; background:#fff; padding:11px 15px; border-radius:12px; cursor:pointer; font-weight:700; }
      .karsa-crop-footer .primary { background:#c9a45c; border-color:#c9a45c; color:#fff; }
      @media(max-width:520px){ .karsa-crop-card{padding:16px;border-radius:20px}.karsa-crop-stage{width:min(88vw,390px)} }

      .karsa-profile-btn.identity{background:#111;color:#d3b06a;border:1px solid #3f3625}
      .karsa-identity-modal{position:fixed;inset:0;z-index:10001;display:flex;align-items:center;justify-content:center;padding:18px;background:rgba(4,4,4,.78);backdrop-filter:blur(16px)}
      .karsa-identity-modal.hidden{display:none}
      .karsa-identity-shell{width:min(760px,100%);max-height:94vh;overflow:auto;background:#f7f5f0;color:#111;border:1px solid rgba(201,164,92,.35);border-radius:28px;padding:26px;box-shadow:0 40px 100px rgba(0,0,0,.45)}
      .karsa-identity-head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px}.karsa-identity-head small{display:block;color:#9a7a3b;font-size:10px;letter-spacing:.18em;font-weight:800}.karsa-identity-head h3{margin:5px 0 0;font-size:25px}
      .karsa-id-scene{display:flex;justify-content:center;perspective:1200px;padding:10px 0 20px}.karsa-id-card{width:min(620px,92vw);aspect-ratio:1.586;position:relative;transform-style:preserve-3d;transition:transform .65s cubic-bezier(.2,.7,.2,1)}.karsa-id-card.flipped{transform:rotateY(180deg)}
      .karsa-id-face{position:absolute;inset:0;backface-visibility:hidden;border-radius:24px;overflow:hidden;color:#fff;background:radial-gradient(circle at 85% 15%,rgba(201,164,92,.18),transparent 30%),linear-gradient(135deg,#080808,#15130f 55%,#080808);box-shadow:0 24px 55px rgba(0,0,0,.28);border:1px solid rgba(201,164,92,.5)}.karsa-id-face:before{content:"";position:absolute;inset:0;background:linear-gradient(120deg,transparent 35%,rgba(255,255,255,.045) 50%,transparent 65%);pointer-events:none}.karsa-id-back{transform:rotateY(180deg);display:flex;flex-direction:column;align-items:center;justify-content:center;background:radial-gradient(circle at 50% 25%,rgba(201,164,92,.16),transparent 34%),linear-gradient(145deg,#080808,#191612)}
      .karsa-id-noise{position:absolute;inset:0;opacity:.08;background-image:radial-gradient(#fff .5px,transparent .5px);background-size:5px 5px}.karsa-id-top{position:relative;display:flex;justify-content:space-between;align-items:center;padding:28px 32px 0}.karsa-id-brand,.karsa-id-back-brand{font-size:28px;font-weight:900;letter-spacing:.16em;color:#d3b06a}.karsa-id-top span{font-size:9px;letter-spacing:.2em;color:#bba77b}.karsa-id-main{position:relative;display:flex;align-items:center;gap:24px;padding:30px 32px}.karsa-id-photo{width:128px;height:128px;flex:0 0 128px;border-radius:18px;background:#222 center/cover no-repeat;display:flex;align-items:center;justify-content:center;font-size:40px;font-weight:800;color:#d3b06a;border:1px solid rgba(201,164,92,.65);box-shadow:0 12px 30px rgba(0,0,0,.3)}.karsa-id-info{min-width:0}.karsa-id-name{font-size:clamp(20px,4vw,32px);font-weight:800;letter-spacing:.01em;line-height:1.1}.karsa-id-title{margin-top:7px;color:#d2bd91;font-size:13px}.karsa-id-line{width:150px;border-top:1px solid #806633;margin:13px 0}.karsa-id-meta{font-size:12px;color:#f0ede6}.karsa-id-id{font-size:10px;color:#a99d86;margin-top:6px;letter-spacing:.1em}.karsa-id-bottom{position:absolute;left:32px;right:32px;bottom:24px;display:flex;justify-content:space-between;align-items:center;font-size:8px;letter-spacing:.12em;color:#a79a80}.karsa-id-bottom b{color:#d3b06a}.karsa-id-back-brand{font-size:34px}.karsa-id-back-title{margin:8px 0 14px;color:#c9ad72;font-size:10px;letter-spacing:.22em}.karsa-id-qr{background:#fff;padding:8px;border-radius:12px;min-width:148px;min-height:148px;display:flex;align-items:center;justify-content:center}.karsa-id-qr img{display:block}.karsa-id-verify{margin-top:10px;font-size:10px;letter-spacing:.16em;color:#c9ad72}.karsa-id-back-footer{position:absolute;bottom:20px;left:30px;right:30px;text-align:center;color:#77736b;font-size:8px}.karsa-id-controls{display:flex;justify-content:center;gap:10px;flex-wrap:wrap}.karsa-id-controls button{border:1px solid #d8cfbf;background:#fff;border-radius:12px;padding:11px 16px;font-weight:700;cursor:pointer}.karsa-id-note{text-align:center;color:#8b867d;font-size:11px;margin-top:14px;line-height:1.5}
      @media(max-width:600px){.karsa-identity-shell{padding:18px;border-radius:22px}.karsa-id-top{padding:18px 20px 0}.karsa-id-brand{font-size:20px}.karsa-id-top span{font-size:7px}.karsa-id-main{gap:14px;padding:20px}.karsa-id-photo{width:84px;height:84px;flex-basis:84px;border-radius:13px;font-size:28px}.karsa-id-name{font-size:18px}.karsa-id-title{font-size:10px}.karsa-id-line{margin:8px 0;width:90px}.karsa-id-meta{font-size:9px}.karsa-id-id{font-size:8px}.karsa-id-bottom{left:20px;right:20px;bottom:15px;font-size:6px}.karsa-id-qr{min-width:100px;min-height:100px;padding:6px}.karsa-id-qr img{width:88px!important;height:88px!important}.karsa-id-back-brand{font-size:25px}.karsa-id-back-title{font-size:7px}.karsa-id-verify{font-size:7px}.karsa-id-back-footer{font-size:6px;bottom:13px}}
    `;
    document.head.appendChild(style);

    const modal = document.createElement("div");
    modal.id = "karsaProfileModal";
    modal.className = "karsa-profile-modal hidden";
    modal.innerHTML = `
      <div class="karsa-profile-card" role="dialog" aria-modal="true" aria-label="Profil pengguna">
        <div class="karsa-profile-head">
          <div><small>KARSA ACCOUNT</small><h2>Profil Saya</h2></div>
          <button class="karsa-profile-close" type="button" data-profile-close>×</button>
        </div>
        <div class="karsa-profile-avatar-wrap">
          <div id="profileAvatarPreview" class="karsa-profile-avatar">K</div>
        </div>
        <div class="karsa-profile-actions">
          <label class="karsa-profile-btn gold" style="cursor:pointer">
            Pilih Foto
            <input id="profileAvatarInput" type="file" accept="image/*" hidden>
          </label>
          <button id="removeAvatarBtn" class="karsa-profile-btn danger" type="button">Hapus Foto</button>
        </div>
        <div class="karsa-profile-field">
          <label for="profileNameInput">NAMA</label>
          <input id="profileNameInput" type="text" autocomplete="name">
        </div>
        <div class="karsa-profile-meta">
          <div><span>Email</span><strong id="profileEmailText">—</strong></div>
          <div><span>Jabatan</span><strong id="profileTitleText">—</strong></div>
          <div><span>Divisi</span><strong id="profileDivisionText">—</strong></div>
        </div>
        <div class="karsa-profile-note">Foto profil maksimal 5 MB. Format gambar umum didukung.</div>
        <div class="karsa-profile-footer">
          <button id="openIdentityCardBtn" class="karsa-profile-btn identity" type="button">Kartu Identitas</button>
          <button class="karsa-profile-btn" type="button" data-profile-close>Tutup</button>
          <button id="saveProfileBtn" class="karsa-profile-btn gold" type="button">Simpan Perubahan</button>
        </div>
        <button id="profileLogoutBtn" class="karsa-profile-logout" type="button">Keluar dari akun</button>
      </div>`;
    document.body.appendChild(modal);

    modal.addEventListener("click", e => {
      if (e.target === modal || e.target.closest("[data-profile-close]")) closeProfile();
    });

    const identityModal = document.createElement("div");
    identityModal.id = "karsaIdentityModal";
    identityModal.className = "karsa-identity-modal hidden";
    identityModal.innerHTML = `
      <div class="karsa-identity-shell" role="dialog" aria-modal="true" aria-label="Kartu Identitas KARSA">
        <div class="karsa-identity-head">
          <div><small>KARSA EXECUTIVE IDENTITY</small><h3>Kartu Identitas</h3></div>
          <button class="karsa-profile-close" type="button" data-identity-close>×</button>
        </div>
        <div class="karsa-id-scene">
          <div id="karsaIdentityCard" class="karsa-id-card">
            <div class="karsa-id-face karsa-id-front">
              <div class="karsa-id-noise"></div>
              <div class="karsa-id-top"><div class="karsa-id-brand">KARSA</div><span>EXECUTIVE ID</span></div>
              <div class="karsa-id-main">
                <div id="identityPhoto" class="karsa-id-photo">K</div>
                <div class="karsa-id-info">
                  <div id="identityName" class="karsa-id-name">—</div>
                  <div id="identityTitle" class="karsa-id-title">—</div>
                  <div class="karsa-id-line"></div>
                  <div id="identityDivision" class="karsa-id-meta">—</div>
                  <div id="identityEmployeeId" class="karsa-id-id">ID —</div>
                </div>
              </div>
              <div class="karsa-id-bottom"><span>PT KARSA LIFESTYLE NUSANTARA</span><b>ACTIVE</b></div>
            </div>
            <div class="karsa-id-face karsa-id-back">
              <div class="karsa-id-back-brand">KARSA</div>
              <div class="karsa-id-back-title">IDENTITY VERIFICATION</div>
              <div id="identityQr" class="karsa-id-qr"></div>
              <div id="identityVerifyText" class="karsa-id-verify">KARSA IDENTITY</div>
              <div class="karsa-id-back-footer">This digital identity belongs to an authorized KARSA account.</div>
            </div>
          </div>
        </div>
        <div class="karsa-id-controls">
          <button id="flipIdentityBtn" type="button">↻ Balik Kartu</button>
          <button id="printIdentityBtn" type="button">Cetak</button>
        </div>
        <div class="karsa-id-note">Kartu mengikuti data profil yang tersimpan pada akun. QR digunakan untuk verifikasi identitas internal.</div>
      </div>`;
    document.body.appendChild(identityModal);
    identityModal.addEventListener("click", e => {
      if (e.target === identityModal || e.target.closest("[data-identity-close]")) closeIdentityCard();
    });
    $("flipIdentityBtn").addEventListener("click", () => $("karsaIdentityCard").classList.toggle("flipped"));
    $("printIdentityBtn").addEventListener("click", printIdentityCard);

    const cropModal = document.createElement("div");
    cropModal.id = "karsaCropModal";
    cropModal.className = "karsa-crop-modal hidden";
    cropModal.innerHTML = `
      <div class="karsa-crop-card" role="dialog" aria-modal="true" aria-label="Sesuaikan foto profil">
        <div class="karsa-crop-head">
          <div><small>KARSA PROFILE</small><h3>Sesuaikan Foto</h3></div>
          <button class="karsa-profile-close" type="button" data-crop-close>×</button>
        </div>
        <div id="karsaCropStage" class="karsa-crop-stage">
          <canvas id="karsaCropCanvas" width="512" height="512"></canvas>
          <div class="karsa-crop-guide"></div>
        </div>
        <div class="karsa-crop-tools">
          <button type="button" id="cropZoomOut" aria-label="Perkecil">−</button>
          <input id="karsaCropZoom" type="range" min="1" max="3.5" step="0.01" value="1">
          <button type="button" id="cropZoomIn" aria-label="Perbesar">+</button>
        </div>
        <div class="karsa-crop-help">Geser foto untuk mengatur posisi. Gunakan slider atau tombol +/− untuk memperbesar.</div>
        <div class="karsa-crop-footer">
          <button type="button" data-crop-close>Batal</button>
          <button type="button" id="useCroppedAvatar" class="primary">Gunakan Foto</button>
        </div>
      </div>`;
    document.body.appendChild(cropModal);

    cropModal.addEventListener("click", e => {
      if (e.target === cropModal || e.target.closest("[data-crop-close]")) closeCropper();
    });
    $("cropZoomOut").addEventListener("click", () => adjustCropZoom(-0.15));
    $("cropZoomIn").addEventListener("click", () => adjustCropZoom(0.15));
    $("karsaCropZoom").addEventListener("input", e => {
      if (!window.__karsaCrop) return;
      window.__karsaCrop.scale = Number(e.target.value);
      drawCropper();
    });
    $("useCroppedAvatar").addEventListener("click", useCroppedAvatar);

    const cropStage = $("karsaCropStage");
    cropStage.addEventListener("pointerdown", e => {
      const c = window.__karsaCrop;
      if (!c) return;
      cropStage.setPointerCapture(e.pointerId);
      c.dragging = true;
      c.pointerId = e.pointerId;
      c.lastX = e.clientX;
      c.lastY = e.clientY;
      cropStage.classList.add("dragging");
    });
    cropStage.addEventListener("pointermove", e => {
      const c = window.__karsaCrop;
      if (!c || !c.dragging || c.pointerId !== e.pointerId) return;
      c.x += e.clientX - c.lastX;
      c.y += e.clientY - c.lastY;
      c.lastX = e.clientX;
      c.lastY = e.clientY;
      drawCropper();
    });
    const endCropDrag = e => {
      const c = window.__karsaCrop;
      if (!c || c.pointerId !== e.pointerId) return;
      c.dragging = false;
      cropStage.classList.remove("dragging");
    };
    cropStage.addEventListener("pointerup", endCropDrag);
    cropStage.addEventListener("pointercancel", endCropDrag);
    cropStage.addEventListener("wheel", e => {
      e.preventDefault();
      adjustCropZoom(e.deltaY > 0 ? -0.08 : 0.08);
    }, {passive:false});

    $("profileAvatarInput").addEventListener("change", async e => {
      const file = e.target.files?.[0];
      if (file) openCropper(file);
      e.target.value = "";
    });

    $("removeAvatarBtn").addEventListener("click", removeAvatar);
    $("saveProfileBtn").addEventListener("click", saveProfile);
    $("profileLogoutBtn").addEventListener("click", async () => {
      closeProfile();
      await logout();
    });
    $("openIdentityCardBtn").addEventListener("click", openIdentityCard);
  }

  function getIdentityId() {
    const u = state.user || {};
    if (u.employeeId) return u.employeeId;
    const code = ({Finance:"FIN", IT:"IT", Operasional:"OPS", "R&D":"RND"})[u.division] || "KRS";
    const raw = String(u.id || "").replace(/-/g, "").slice(0, 6).toUpperCase() || "000000";
    return `KRSA-${code}-${raw}`;
  }

  function loadQrLibrary() {
    return new Promise((resolve, reject) => {
      if (window.qrcode) return resolve(window.qrcode);
      const existing = document.querySelector('script[data-karsa-qr]');
      if (existing) {
        existing.addEventListener("load", () => resolve(window.qrcode));
        existing.addEventListener("error", reject);
        return;
      }
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js";
      script.async = true;
      script.dataset.karsaQr = "1";
      script.onload = () => window.qrcode ? resolve(window.qrcode) : reject(new Error("QR library unavailable"));
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  async function renderIdentityQr() {
    const box = $("identityQr");
    if (!box || !state.user) return;
    box.innerHTML = "";
    try {
      const qr = await loadQrLibrary();
      const verifyUrl = `${location.origin}${location.pathname}?verify=${encodeURIComponent(getIdentityId())}`;
      const q = qr(0, "M");
      q.addData(verifyUrl);
      q.make();
      box.innerHTML = q.createImgTag(4, 0);
      const img = box.querySelector("img");
      if (img) { img.alt = "QR verifikasi identitas"; img.style.width = "132px"; img.style.height = "132px"; img.style.display = "block"; }
    } catch (err) {
      box.textContent = "QR";
    }
  }

  function openIdentityCard() {
    if (!state.user) return;
    const u = state.user;
    $("identityName").textContent = u.name || "—";
    $("identityTitle").textContent = u.title || roleLabel(u.role) || "—";
    $("identityDivision").textContent = u.division || "—";
    $("identityEmployeeId").textContent = `ID ${getIdentityId()}`;
    $("identityVerifyText").textContent = getIdentityId();
    const photo = $("identityPhoto");
    photo.textContent = u.avatarUrl ? "" : (u.initials || initials(u.name));
    photo.style.backgroundImage = u.avatarUrl ? `url("${u.avatarUrl}")` : "";
    $("karsaIdentityCard").classList.remove("flipped");
    $("karsaIdentityModal").classList.remove("hidden");
    renderIdentityQr();
  }

  function closeIdentityCard() {
    $("karsaIdentityModal")?.classList.add("hidden");
  }

  function printIdentityCard() {
    if (!state.user) return;
    const card = $("karsaIdentityCard");
    const printWin = window.open("", "_blank", "width=900,height=700");
    if (!printWin) { showToast("Izinkan pop-up untuk mencetak kartu."); return; }

    const front = card.querySelector(".karsa-id-front").outerHTML
      .replaceAll("karsa-id-face", "face")
      .replaceAll("karsa-id-front", "front")
      .replaceAll("karsa-id-noise", "noise")
      .replaceAll("karsa-id-top", "top")
      .replaceAll("karsa-id-brand", "brand")
      .replaceAll("karsa-id-main", "main")
      .replaceAll("karsa-id-photo", "photo")
      .replaceAll("karsa-id-info", "info")
      .replaceAll("karsa-id-name", "name")
      .replaceAll("karsa-id-title", "title")
      .replaceAll("karsa-id-line", "line")
      .replaceAll("karsa-id-meta", "meta")
      .replaceAll("karsa-id-id", "id")
      .replaceAll("karsa-id-bottom", "bottom");

    const back = card.querySelector(".karsa-id-back").outerHTML
      .replaceAll("karsa-id-face", "face")
      .replaceAll("karsa-id-back", "back")
      .replaceAll("karsa-id-brand", "brand")
      .replaceAll("karsa-id-back-title", "verify")
      .replaceAll("karsa-id-qr", "qr")
      .replaceAll("karsa-id-verify", "verifyText")
      .replaceAll("karsa-id-back-footer", "foot");

    const html = `<!doctype html><html><head><title>Kartu Identitas KARSA</title><style>
      @page{size:auto;margin:12mm}body{margin:0;background:#fff;display:flex;justify-content:center;align-items:flex-start;padding:20px;font-family:Arial,sans-serif}.wrap{display:flex;gap:20px}.card{width:340px;height:214px;position:relative;border-radius:20px;overflow:hidden;background:#0b0b0b;color:#fff;box-shadow:0 12px 30px #aaa}.face{position:relative;width:340px;height:214px;padding:22px;box-sizing:border-box;border-radius:20px;overflow:hidden;background:linear-gradient(135deg,#080808,#17130d);color:#fff;border:1px solid #8b6f35}.top{display:flex;justify-content:space-between;align-items:center}.brand{font-size:25px;font-weight:900;letter-spacing:.12em;color:#d3b06a}.main{display:flex;gap:16px;align-items:center;margin-top:26px}.photo{width:78px;height:78px;border-radius:14px;background:#242424 center/cover no-repeat;display:flex;align-items:center;justify-content:center;font-size:26px;font-weight:800;color:#d3b06a}.name{font-size:18px;font-weight:800}.title{font-size:11px;color:#c7b58c;margin-top:4px}.line{width:100px;border-top:1px solid #806633;margin:9px 0}.meta{font-size:10px;color:#eee}.id{font-size:9px;letter-spacing:.08em;color:#aaa;margin-top:5px}.bottom{position:absolute;left:22px;right:22px;bottom:16px;display:flex;justify-content:space-between;font-size:7px;letter-spacing:.1em;color:#9e8b62}.back{display:flex;flex-direction:column;align-items:center;justify-content:center;background:linear-gradient(145deg,#0a0a0a,#191612)}.back .brand{font-size:30px}.back .verify{font-size:9px;letter-spacing:.18em;color:#c9ad72;margin:7px}.qr{background:#fff;padding:7px;border-radius:10px}.qr img{width:120px;height:120px;display:block}.verifyText{font-size:8px;letter-spacing:.16em;color:#c9ad72;margin-top:7px}.foot{font-size:7px;color:#8f8f8f;text-align:center;margin-top:9px}</style></head><body><div class="wrap"><div class="card">${front}</div><div class="card">${back}</div></div><script>window.onload=function(){window.print();};</script></body></html>`;
    printWin.document.open();
    printWin.document.write(html);
    printWin.document.close();
  }

  function openProfile() {
    if (!state.user) return;
    ensureProfileUI();

    $("profileNameInput").value = state.user.name || "";
    $("profileEmailText").textContent = state.user.email || "—";
    $("profileTitleText").textContent = state.user.title || roleLabel(state.user.role);
    $("profileDivisionText").textContent = state.user.division || "—";
    renderProfileAvatar();
    $("karsaProfileModal").classList.remove("hidden");
  }

  function closeProfile() {
    $("karsaProfileModal")?.classList.add("hidden");
  }

  function renderProfileAvatar() {
    const el = $("profileAvatarPreview");
    if (!el || !state.user) return;
    el.textContent = state.user.avatarUrl ? "" : (state.user.initials || initials(state.user.name));
    el.style.backgroundImage = state.user.avatarUrl
      ? `url("${state.user.avatarUrl}")`
      : "";
  }

  async function saveProfile() {
    if (!client || !state.user) return;
    const name = $("profileNameInput").value.trim();
    if (!name) {
      showToast("Nama tidak boleh kosong.");
      return;
    }

    const { data, error } = await client.rpc("update_my_profile", {
      p_name: name,
      p_avatar_url: state.user.avatarUrl || null
    });

    if (error) {
      showToast(error.message || "Profil gagal diperbarui.");
      return;
    }

    state.user.name = data?.name || name;
    state.user.initials = initials(state.user.name);
    state.user.avatarUrl = data?.avatar_url || state.user.avatarUrl || "";
    renderAll();
    renderProfileAvatar();
    showToast("Profil berhasil diperbarui.");
  }

  function openCropper(file) {
    if (!file || !state.user) return;

    if (!file.type.startsWith("image/")) {
      showToast("File harus berupa gambar.");
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      showToast("Ukuran foto asli maksimal 10 MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = $("karsaCropCanvas");
        const size = 512;
        const baseScale = Math.max(size / img.naturalWidth, size / img.naturalHeight);
        window.__karsaCrop = {
          img,
          canvas,
          size,
          baseScale,
          scale: 1,
          x: 0,
          y: 0,
          dragging: false,
          pointerId: null,
          lastX: 0,
          lastY: 0
        };
        $("karsaCropZoom").value = "1";
        drawCropper();
        $("karsaCropModal").classList.remove("hidden");
      };
      img.onerror = () => showToast("Foto tidak dapat dibaca.");
      img.src = reader.result;
    };
    reader.onerror = () => showToast("Foto tidak dapat dibaca.");
    reader.readAsDataURL(file);
  }

  function closeCropper() {
    $("karsaCropModal")?.classList.add("hidden");
    const c = window.__karsaCrop;
    if (c?.img?.src?.startsWith("blob:")) URL.revokeObjectURL(c.img.src);
    window.__karsaCrop = null;
  }

  function adjustCropZoom(delta) {
    const c = window.__karsaCrop;
    if (!c) return;
    c.scale = Math.min(3.5, Math.max(1, c.scale + delta));
    $("karsaCropZoom").value = String(c.scale);
    drawCropper();
  }

  function drawCropper() {
    const c = window.__karsaCrop;
    if (!c) return;
    const ctx = c.canvas.getContext("2d");
    const drawScale = c.baseScale * c.scale;
    const w = c.img.naturalWidth * drawScale;
    const h = c.img.naturalHeight * drawScale;

    ctx.clearRect(0, 0, c.size, c.size);
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, c.size, c.size);
    ctx.drawImage(
      c.img,
      (c.size - w) / 2 + c.x,
      (c.size - h) / 2 + c.y,
      w,
      h
    );
  }

  async function useCroppedAvatar() {
    const c = window.__karsaCrop;
    if (!c || !client || !state.user) return;

    const canvas = c.canvas;
    canvas.toBlob(async blob => {
      if (!blob) {
        showToast("Foto gagal diproses.");
        return;
      }

      closeCropper();
      await uploadCroppedAvatar(blob);
    }, "image/jpeg", 0.92);
  }

  async function uploadCroppedAvatar(blob) {
    const path = `${state.user.id}/avatar-${Date.now()}.jpg`;
    const oldUrl = state.user.avatarUrl || "";
    const oldPath = avatarPathFromUrl(oldUrl);

    const { error: uploadError } = await client.storage
      .from(AVATAR_BUCKET)
      .upload(path, blob, {
        cacheControl: "3600",
        contentType: "image/jpeg",
        upsert: false
      });

    if (uploadError) {
      showToast(uploadError.message || "Foto gagal diupload.");
      return;
    }

    const { data: publicData } = client.storage
      .from(AVATAR_BUCKET)
      .getPublicUrl(path);

    const avatarUrl = `${publicData.publicUrl}?v=${Date.now()}`;
    const { data, error } = await client.rpc("update_my_profile", {
      p_name: state.user.name,
      p_avatar_url: avatarUrl
    });

    if (error) {
      await client.storage.from(AVATAR_BUCKET).remove([path]);
      showToast(error.message || "Profil gagal diperbarui.");
      return;
    }

    state.user.avatarUrl = data?.avatar_url || avatarUrl;
    renderUser();
    renderProfileAvatar();

    if (oldPath && oldPath !== path) {
      await client.storage.from(AVATAR_BUCKET).remove([oldPath]);
    }

    showToast("Foto profil berhasil diperbarui.");
  }

  async function removeAvatar() {
    if (!client || !state.user) return;

    const oldPath = avatarPathFromUrl(state.user.avatarUrl || "");
    const { data, error } = await client.rpc("update_my_profile", {
      p_name: state.user.name,
      p_avatar_url: null
    });

    if (error) {
      showToast(error.message || "Foto profil gagal dihapus.");
      return;
    }

    if (oldPath) {
      await client.storage.from(AVATAR_BUCKET).remove([oldPath]);
    }

    state.user.avatarUrl = data?.avatar_url || "";
    renderUser();
    renderProfileAvatar();
    showToast("Foto profil dihapus.");
  }

  /*
   * =========================================================
   * LOGIN
   * =========================================================
   */

  async function realLogin(
    email,
    password
  ) {
    const {
      data,
      error
    } =
      await client.auth.signInWithPassword(
        {
          email,
          password
        }
      );

    if (error) {
      throw error;
    }

    const uid =
      data.user.id;

    const {
      data: profile,
      error: pe
    } =
      await client
        .from("profiles")
        .select("*")
        .eq("id", uid)
        .single();

    if (pe || !profile) {
      throw new Error(
        "Akun berhasil login, tetapi profil internal belum dibuat."
      );
    }

    state.user = {
      id: uid,
      name: profile.name,
      email: profile.email,
      role: profile.role,
      division:
        profile.division,
      initials:
        initials(
          profile.name
        ),
      title:
        profile.title ||
        roleLabel(
          profile.role
        ),
      employeeId:
        profile.employee_id ||
        "",
      avatarUrl:
        profile.avatar_url ||
        ""
    };
  }

  /*
   * =========================================================
   * ENTER APP
   * =========================================================
   */

  async function enterApp() {
    $("loginPage").classList.add(
      "hidden"
    );

    $("app").classList.remove(
      "hidden"
    );

    await loadJobs();

    loadActivities();

    await loadAssignees();

    renderAll();

    showView(
      "dashboard"
    );
  }

  /*
   * =========================================================
   * LOGOUT
   * =========================================================
   */

  async function logout() {
    if (client) {
      await client.auth.signOut();
    }

    state.user = null;

    $("app").classList.add(
      "hidden"
    );

    $("loginPage").classList.remove(
      "hidden"
    );
  }

  /*
   * =========================================================
   * TOAST
   * =========================================================
   */

  function showToast(msg) {
    const t =
      $("toast");

    if (!t) return;

    t.textContent =
      msg;

    t.classList.add(
      "show"
    );

    clearTimeout(
      window.__toast
    );

    window.__toast =
      setTimeout(
        () =>
          t.classList.remove(
            "show"
          ),
        2600
      );
  }

  /*
   * =========================================================
   * EXPORT CSV
   * =========================================================
   */

  function exportCSV() {
    const rows = [
      [
        "ID",
        "Pekerjaan",
        "Divisi",
        "PIC",
        "Deadline",
        "Progress",
        "Status",
        "Prioritas",
        "Kendala",
        "Next Action"
      ],

      ...visibleJobs().map(
        j => [
          j.id,
          j.title,
          j.division,
          j.assignee,
          j.deadline,
          j.progress,
          j.status,
          j.priority,
          j.blocker,
          j.nextAction
        ]
      )
    ];

    const csv =
      rows
        .map(
          r =>
            r
              .map(
                v =>
                  `"${String(
                    v ?? ""
                  ).replaceAll(
                    '"',
                    '""'
                  )}"`
              )
              .join(",")
        )
        .join("\n");

    const a =
      document.createElement(
        "a"
      );

    a.href =
      URL.createObjectURL(
        new Blob(
          [csv],
          {
            type:
              "text/csv"
          }
        )
      );

    a.download =
      "karsa-weekly-review.csv";

    a.click();

    URL.revokeObjectURL(
      a.href
    );
  }

  /*
   * =========================================================
   * LOAD ASSIGNEES
   * =========================================================
   *
   * Director / GM / HDO dapat memilih:
   *
   * - General Manager
   * - Head Divisi Operasional
   * - Head Divisi
   * - Staff
   *
   * Director tidak dimasukkan sebagai PIC.
   */

  async function loadAssignees() {
    const select =
      document.querySelector(
        'select[name="assigneeId"]'
      );

    if (!select) return;

    if (!client) {
      select.innerHTML =
        '<option value="">Hubungkan Supabase untuk memilih akun</option>';

      return;
    }

    const {
      data,
      error
    } =
      await client
        .from("profiles")
        .select(
          "id,name,email,division,role"
        )
        .order(
          "division"
        )
        .order(
          "name"
        );

    if (error) {
      select.innerHTML =
        '<option value="">Gagal memuat akun</option>';

      return;
    }

    select.innerHTML =
      '<option value="">Pilih PIC...</option>' +

      data
        .filter(
          p =>
            [
              "general_manager",
              "operational_head",
              "division_head",
              "staff"
            ].includes(
              p.role
            )
        )
        .map(
          p =>
            `<option
              value="${p.id}"
              data-name="${esc(
                p.name
              )}"
              data-division="${esc(
                p.division
              )}"
            >
              ${esc(
                p.name
              )} •
              ${esc(
                p.division
              )} •
              ${roleLabel(
                p.role
              )}
            </option>`
        )
        .join("");
  }

  /*
   * =========================================================
   * BIND EVENTS
   * =========================================================
   */

  function bind() {

    ensureProfileUI();

    [$("sideAvatar"), $("sideName"), $("mobileAvatar")]
      .filter(Boolean)
      .forEach(el => {
        el.classList.add("karsa-profile-trigger");
        el.title = "Buka profil";
        el.addEventListener("click", openProfile);
      });

    document
      .querySelectorAll(
        ".nav-item"
      )
      .forEach(
        b =>
          b.addEventListener(
            "click",
            () =>
              showView(
                b.dataset.view
              )
          )
      );

    document
      .querySelectorAll(
        "[data-view-link]"
      )
      .forEach(
        b =>
          b.addEventListener(
            "click",
            () =>
              showView(
                b.dataset.viewLink
              )
          )
      );

    $("menuBtn").addEventListener(
      "click",
      () => {
        const sidebar = $("sidebar");
        const backdrop = $("sidebarBackdrop");
        const open = !sidebar.classList.contains("open");
        sidebar.classList.toggle("open", open);
        backdrop?.classList.toggle("show", open);
      }
    );

    $("togglePass").addEventListener(
      "click",
      () => {
        $("loginPassword").type =
          $("loginPassword").type ===
          "password"
            ? "text"
            : "password";
      }
    );

    /*
     * LOGIN
     */

    $("loginForm").addEventListener(
      "submit",
      async e => {
        e.preventDefault();

        $("loginError").textContent =
          "";

        if (!client) {
          $("loginError").textContent =
            "Sistem belum terhubung ke Supabase. Hubungkan config.js terlebih dahulu.";

          return;
        }

        try {
          await realLogin(
            $(
              "loginEmail"
            ).value.trim(),

            $(
              "loginPassword"
            ).value
          );

          await enterApp();

        } catch (err) {
          $("loginError").textContent =
            err.message ||
            "Login gagal.";
        }
      }
    );

    /*
     * LOGOUT
     */

    $("logoutBtn").addEventListener(
      "click",
      logout
    );

    /*
     * SEARCH
     */

    $("searchJobs").addEventListener(
      "input",
      e => {
        state.filterText =
          e.target.value;

        renderJobs();
      }
    );

    /*
     * STATUS FILTER
     */

    $("statusFilter").addEventListener(
      "change",
      e => {
        state.filterStatus =
          e.target.value;

        renderJobs();
      }
    );

    /*
     * DIVISION FILTER
     */

    $("divisionFilter").addEventListener(
      "change",
      e => {
        state.filterDivision =
          e.target.value;

        renderJobs();
      }
    );

    /*
     * NEW JOB
     */

    $("newJobBtn").addEventListener(
      "click",
      () =>
        showView(
          "create"
        )
    );

    $("quickAdd").addEventListener(
      "click",
      () =>
        showView(
          "create"
        )
    );

    /*
     * JOB FORM
     *
     * PENTING:
     * sebelumnya memakai isOps()
     * yang tidak pernah didefinisikan.
     *
     * Sekarang menggunakan canAssign().
     */

    $("jobForm").addEventListener(
      "submit",
      async e => {
        e.preventDefault();

        if (!canAssign()) {
          showToast(
            "Akun ini tidak memiliki akses untuk memberikan pekerjaan."
          );

          return;
        }

        const f =
          new FormData(
            e.currentTarget
          );

        const opt =
          document.querySelector(
            'select[name="assigneeId"] option:checked'
          );

        const selectedDivision =
          f.get(
            "division"
          );

        const selectedAssigneeId =
          f.get(
            "assigneeId"
          );

        /*
         * Pastikan PIC dipilih
         */

        if (
          !selectedAssigneeId
        ) {
          showToast(
            "Pilih PIC terlebih dahulu."
          );

          return;
        }

        /*
         * Pastikan PIC berasal
         * dari divisi yang sama.
         */

        const picDivision =
          opt?.dataset
            .division || "";

        if (
          picDivision &&
          picDivision !==
            selectedDivision
        ) {
          showToast(
            "PIC harus berasal dari divisi tujuan."
          );

          return;
        }

        const ok =
          await createJob({
            title:
              f.get(
                "title"
              ),

            division:
              selectedDivision,

            assigneeId:
              selectedAssigneeId,

            assignee:
              opt?.dataset
                .name ||
              "",

            deadline:
              f.get(
                "deadline"
              ),

            priority:
              f.get(
                "priority"
              ),

            description:
              f.get(
                "description"
              ),

            nextAction:
              f.get(
                "nextAction"
              )
          });

        if (ok) {
          e.currentTarget.reset();

          $("routeDivision").textContent =
            "Finance";

          $("routePic").textContent =
            "PIC";

          renderAll();

          showView(
            "jobs"
          );
        }
      }
    );

    /*
     * DIVISION ROUTING
     */

    document
      .querySelector(
        'select[name="division"]'
      )
      .addEventListener(
        "change",
        e => {
          $("routeDivision").textContent =
            e.target.value;

          /*
           * Reset PIC agar tidak
           * salah divisi setelah
           * tujuan berubah.
           */

          const picSelect =
            document.querySelector(
              'select[name="assigneeId"]'
            );

          if (
            picSelect
          ) {
            picSelect.value =
              "";

            $("routePic").textContent =
              "PIC";
          }
        }
      );

    /*
     * PIC ROUTING
     */

    document
      .querySelector(
        'select[name="assigneeId"]'
      )
      .addEventListener(
        "change",
        e => {
          const opt =
            e.target
              .selectedOptions[0];

          $("routePic").textContent =
            opt?.dataset
              .name ||
            "PIC";
        }
      );

    /*
     * EXPORT
     */

    $("exportBtn").addEventListener(
      "click",
      exportCSV
    );

    /*
     * OPEN JOB / CLOSE MODAL
     */

    document.addEventListener(
      "click",
      e => {
        const b =
          e.target.closest(
            "[data-open-job]"
          );

        if (b) {
          openJob(
            b.dataset.openJob
          );
        }

        if (
          e.target.matches(
            "[data-close-modal]"
          ) ||
          e.target.closest(
            "[data-close-modal]"
          )
        ) {
          closeModal();
        }
      }
    );

    document.addEventListener("keydown", e => {
      if (e.key === "Escape") {
        closeModal();
        closeProfile();
      }
    });
  }

  /*
   * =========================================================
   * CLOCK
   * =========================================================
   */

  function tick() {
    $("clock").textContent =
      new Intl.DateTimeFormat(
        "id-ID",
        {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit"
        }
      ).format(
        new Date()
      );
  }


  /*
   * =========================================================
   * KARSA WORKSPACE EXTENSIONS
   * Calendar • Analytics • Directory • Job Timeline
   * Comments • Attachments • Employee ID / Verification
   * =========================================================
   */

  function karsaExtStyles() {
    if ($("karsaExtStyle")) return;
    const style = document.createElement("style");
    style.id = "karsaExtStyle";
    style.textContent = `
      .karsa-ext-nav{margin:14px 12px 0;padding-top:14px;border-top:1px solid rgba(201,164,92,.14)}
      .karsa-ext-label{padding:0 12px 8px;color:#8d8a82;font-size:9px;font-weight:800;letter-spacing:.18em}
      .karsa-ext-nav button{width:100%;display:flex;align-items:center;gap:10px;border:0;background:transparent;color:inherit;padding:10px 12px;border-radius:12px;cursor:pointer;text-align:left;font:inherit;font-size:12px}
      .karsa-ext-nav button:hover{background:rgba(201,164,92,.08);color:#c9a45c}
      .karsa-ext-nav button span:first-child{width:22px;text-align:center}
      .karsa-ext-overlay{position:fixed;inset:0;z-index:9998;background:rgba(5,5,5,.76);backdrop-filter:blur(16px);display:flex;align-items:center;justify-content:center;padding:18px}
      .karsa-ext-overlay.hidden{display:none}
      .karsa-ext-shell{width:min(1120px,100%);max-height:92vh;overflow:auto;background:#f7f6f2;color:#161616;border:1px solid rgba(201,164,92,.35);border-radius:28px;box-shadow:0 35px 100px rgba(0,0,0,.48)}
      .karsa-ext-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:24px 26px 18px;border-bottom:1px solid #e6e2d9;position:sticky;top:0;background:rgba(247,246,242,.96);backdrop-filter:blur(10px);z-index:2}
      .karsa-ext-head small{display:block;color:#9b7b3f;font-size:9px;font-weight:800;letter-spacing:.2em;margin-bottom:5px}.karsa-ext-head h2{margin:0;font-family:Georgia,serif;font-size:28px}
      .karsa-ext-close{width:38px;height:38px;border:1px solid #ddd8ce;border-radius:50%;background:#fff;cursor:pointer;font-size:20px}
      .karsa-ext-body{padding:24px 26px 30px}.karsa-ext-toolbar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:18px}.karsa-ext-toolbar select,.karsa-ext-toolbar input{border:1px solid #ddd8ce;background:#fff;border-radius:11px;padding:10px 12px;font:inherit}
      .karsa-cal{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));border:1px solid #e3dfd6;border-radius:18px;overflow:hidden;background:#fff}.karsa-cal-day{min-height:110px;padding:10px;border-right:1px solid #eeeae2;border-bottom:1px solid #eeeae2}.karsa-cal-day:nth-child(7n){border-right:0}.karsa-cal-head{min-height:auto;text-align:center;background:#faf8f3;font-size:10px;font-weight:800;letter-spacing:.08em;color:#777}.karsa-cal-num{font-weight:800;font-size:12px}.karsa-cal-num.today{display:inline-flex;width:25px;height:25px;align-items:center;justify-content:center;border-radius:50%;background:#c9a45c;color:#fff}.karsa-cal-job{margin-top:6px;padding:5px 6px;border-radius:8px;background:#f4efe4;border-left:2px solid #c9a45c;font-size:9px;line-height:1.3;cursor:pointer}.karsa-cal-job.blocked{border-left-color:#b44}.karsa-cal-job.done{opacity:.55}
      .karsa-kpi-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.karsa-kpi{background:#fff;border:1px solid #e5e1d8;border-radius:18px;padding:18px}.karsa-kpi small{display:block;color:#888;font-size:9px;letter-spacing:.14em;font-weight:800}.karsa-kpi strong{display:block;font-size:28px;margin-top:8px}.karsa-analytics-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px}.karsa-panel{background:#fff;border:1px solid #e5e1d8;border-radius:18px;padding:18px}.karsa-panel h3{margin:0 0 14px;font-size:14px}.karsa-bar-row{margin:12px 0}.karsa-bar-label{display:flex;justify-content:space-between;font-size:11px;margin-bottom:6px}.karsa-bar-track{height:8px;border-radius:99px;background:#eee9df;overflow:hidden}.karsa-bar-track span{display:block;height:100%;background:#c9a45c;border-radius:99px}
      .karsa-people-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.karsa-person{background:#fff;border:1px solid #e5e1d8;border-radius:18px;padding:16px;display:flex;gap:12px;align-items:center}.karsa-person-avatar{width:52px;height:52px;border-radius:50%;background:#111;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;background-size:cover;background-position:center;flex:0 0 52px}.karsa-person strong{display:block;font-size:12px}.karsa-person small{display:block;color:#777;margin-top:3px;font-size:10px}.karsa-person-id{font-family:monospace;color:#9b7b3f;font-size:9px!important}
      .karsa-job-extra{margin-top:18px;padding-top:18px;border-top:1px solid #eee}.karsa-extra-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.karsa-extra-box{border:1px solid #e4e0d7;border-radius:15px;background:#faf9f6;padding:14px}.karsa-extra-box h4{margin:0 0 10px;font-size:12px}.karsa-timeline{display:grid;gap:9px;max-height:240px;overflow:auto}.karsa-timeline-item{display:grid;grid-template-columns:9px 1fr;gap:9px}.karsa-timeline-dot{width:8px;height:8px;border-radius:50%;background:#c9a45c;margin-top:5px}.karsa-timeline-item strong{font-size:10px}.karsa-timeline-item small{display:block;color:#777;font-size:9px;margin-top:2px}.karsa-comment-list{display:grid;gap:8px;max-height:220px;overflow:auto}.karsa-comment{padding:9px;border-radius:10px;background:#fff;border:1px solid #ece8df}.karsa-comment strong{font-size:10px}.karsa-comment p{font-size:10px;margin:4px 0 0;white-space:pre-wrap}.karsa-comment small{font-size:8px;color:#999}.karsa-comment-form{display:flex;gap:7px;margin-top:10px}.karsa-comment-form input{min-width:0;flex:1;border:1px solid #ddd8ce;border-radius:9px;padding:9px;font:inherit;font-size:10px}.karsa-mini-btn{border:1px solid #d9d2c5;background:#fff;border-radius:9px;padding:8px 10px;cursor:pointer;font-weight:700;font-size:10px}.karsa-mini-btn.gold{background:#c9a45c;border-color:#c9a45c;color:#fff}.karsa-file-list{display:grid;gap:7px;max-height:170px;overflow:auto}.karsa-file{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px;background:#fff;border:1px solid #ece8df;border-radius:9px}.karsa-file-name{font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.karsa-file-meta{font-size:8px;color:#999}.karsa-empty-mini{font-size:10px;color:#888;padding:10px 0}
      @media(max-width:800px){.karsa-kpi-grid{grid-template-columns:repeat(2,1fr)}.karsa-analytics-grid,.karsa-extra-grid{grid-template-columns:1fr}.karsa-people-grid{grid-template-columns:1fr 1fr}.karsa-cal-day{min-height:88px;padding:7px}.karsa-cal-job{font-size:8px}.karsa-ext-body{padding:18px}.karsa-ext-head{padding:18px}.karsa-ext-head h2{font-size:23px}}
      @media(max-width:520px){.karsa-people-grid{grid-template-columns:1fr}.karsa-kpi strong{font-size:23px}.karsa-cal-day{min-height:76px}.karsa-cal-job{padding:4px}.karsa-cal-day:not(.karsa-cal-head){font-size:9px}}
      /* KARSA UI BUG FIXES */
      #jobModal .modal-content,#jobModal .modal-card,#jobModal .modal-body,#jobModal #modalBody{color:#171717!important;background:#fff!important;}
      #jobModal label{color:#252525!important;font-weight:700;}
      #jobModal label small,#jobModal .update-info small{color:#6f6b63!important;}
      #jobModal input,#jobModal select,#jobModal textarea{color:#171717!important;background:#fff!important;border:1px solid #d9d5cd!important;}
      #jobModal input::placeholder,#jobModal textarea::placeholder{color:#999!important;}
      #jobModal input:disabled,#jobModal select:disabled,#jobModal textarea:disabled{color:#555!important;background:#f3f2ef!important;opacity:1!important;}
      #jobModal .update-info{background:#f7f5f0!important;color:#171717!important;border:1px solid #e5e0d6!important;}
      #jobModal .karsa-job-extra{color:#171717!important;background:transparent!important;}
      #jobModal .karsa-extra-box{color:#171717!important;background:#faf9f6!important;}
      #jobModal .karsa-extra-box h4{color:#252525!important;}
      #jobModal .karsa-timeline-item strong,#jobModal .karsa-comment strong,#jobModal .karsa-file-name{color:#252525!important;}
      #jobModal .karsa-timeline-item small,#jobModal .karsa-comment small,#jobModal .karsa-file-meta,#jobModal .karsa-empty-mini{color:#73706a!important;}
      #jobModal .karsa-comment p{color:#333!important;}
      #jobModal .karsa-comment-form input{color:#171717!important;background:#fff!important;}
      #jobModal .karsa-file{color:#171717!important;background:#fff!important;}
      #jobModal .karsa-mini-btn{color:#252525!important;background:#fff!important;}
      #jobModal .karsa-mini-btn.gold{color:#fff!important;background:#c9a45c!important;}
      .summary-line,.follow-item,.week-bar,.week-bar small{color:#242424!important;}
      .summary-line span:last-child{color:#8f6f34!important;font-weight:800;}
      .follow-item{background:#fff!important;border:1px solid #e7e2d9!important;}
      .follow-item strong{color:#202020!important;}
      .follow-item small{color:#666!important;}
      .week-bar span{background:#c9a45c!important;}
      .week-bar small{font-weight:700;}
      #logoutBtn{display:none!important;}
      .sidebar-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.18);z-index:9990;display:none;}
      .sidebar-backdrop.show{display:block;}
      #sidebar{z-index:9991;}
      .karsa-profile-logout{width:100%;margin-top:12px;border:1px solid #e2caca!important;background:#fff!important;color:#a33b3b!important;padding:12px 14px;border-radius:12px;cursor:pointer;font-weight:800;}
      .karsa-profile-logout:hover{background:#fff4f4!important;}
      .karsa-profile-meta strong{color:#222!important;text-align:right;}
      .karsa-profile-field input{color:#171717!important;background:#fff!important;}
      .karsa-profile-card{color:#171717!important;}
      .karsa-profile-note{color:#777!important;}
      .karsa-person-avatar{overflow:hidden;}
      .karsa-person-avatar img{width:100%;height:100%;object-fit:cover;display:block;}
      @media(max-width:700px){.karsa-extra-grid{grid-template-columns:1fr!important;}#jobModal .karsa-extra-box{grid-column:auto!important;}#jobModal .form-actions{position:sticky;bottom:0;background:#fff;padding-top:10px;}}
    `;
    document.head.appendChild(style);
  }

  function karsaEmployeeId(p) {
    if (p?.employee_id) return p.employee_id;
    const code = ({Finance:"FIN",IT:"IT",Operasional:"OPS","R&D":"RND"})[p?.division] || "KRS";
    const raw = String(p?.id || "").replace(/-/g, "").slice(0,6).toUpperCase() || "000000";
    return `KRSA-${code}-${raw}`;
  }

  function karsaAddNav() {
    if ($("karsaExtNav")) return;
    const sidebar = $("sidebar");
    if (!sidebar) return;
    if (!$("sidebarBackdrop")) {
      const backdrop = document.createElement("div");
      backdrop.id = "sidebarBackdrop";
      backdrop.className = "sidebar-backdrop";
      document.body.appendChild(backdrop);
      backdrop.addEventListener("click", () => sidebar.classList.remove("open"));
    }
    const wrap = document.createElement("div");
    wrap.id = "karsaExtNav";
    wrap.className = "karsa-ext-nav";
    wrap.innerHTML = `
      <div class="karsa-ext-label">CONTROL TOOLS</div>
      <button type="button" data-karsa-ext="calendar"><span>▦</span><span>Calendar</span></button>
      <button type="button" data-karsa-ext="analytics"><span>◫</span><span>Analytics</span></button>
      <button type="button" data-karsa-ext="directory"><span>◎</span><span>People Directory</span></button>`;
    sidebar.appendChild(wrap);
    wrap.addEventListener("click", e => {
      const b = e.target.closest("[data-karsa-ext]");
      if (b) openKarsaExtension(b.dataset.karsaExt);
    });
  }

  function karsaMakeOverlay() {
    if ($("karsaExtOverlay")) return;
    const el = document.createElement("div");
    el.id = "karsaExtOverlay";
    el.className = "karsa-ext-overlay hidden";
    el.innerHTML = `<div class="karsa-ext-shell"><div class="karsa-ext-head"><div><small id="karsaExtEyebrow">KARSA</small><h2 id="karsaExtTitle">Control Center</h2></div><button class="karsa-ext-close" type="button" data-karsa-ext-close>×</button></div><div id="karsaExtBody" class="karsa-ext-body"></div></div>`;
    document.body.appendChild(el);
    el.addEventListener("click", e => {
      if (e.target === el || e.target.closest("[data-karsa-ext-close]")) closeKarsaExtension();
    });
  }

  function closeKarsaExtension(){ $("karsaExtOverlay")?.classList.add("hidden"); }

  function openKarsaExtension(type){
    if (!state.user) return;
    karsaMakeOverlay();
    $("karsaExtOverlay").classList.remove("hidden");
    if (type === "calendar") renderKarsaCalendar();
    if (type === "analytics") renderKarsaAnalytics();
    if (type === "directory") renderKarsaDirectory();
    $("sidebar")?.classList.remove("open");
  }

  function renderKarsaCalendar(){
    $("karsaExtEyebrow").textContent="DEADLINE CENTER";
    $("karsaExtTitle").textContent="Calendar";
    const now = window.__karsaCalendarDate instanceof Date ? window.__karsaCalendarDate : new Date();
    const year=now.getFullYear(), month=now.getMonth();
    window.__karsaCalendarDate=new Date(year,month,1);
    const first=new Date(year,month,1), last=new Date(year,month+1,0);
    const start=(first.getDay()+6)%7;
    const total=last.getDate();
    const names=["Sen","Sel","Rab","Kam","Jum","Sab","Min"];
    const monthName=new Intl.DateTimeFormat("id-ID",{month:"long",year:"numeric"}).format(first);
    let html=`<div class="karsa-ext-toolbar"><button class="karsa-mini-btn" id="kCalPrev">←</button><strong style="min-width:150px;text-align:center">${monthName}</strong><button class="karsa-mini-btn" id="kCalNext">→</button><button class="karsa-mini-btn" id="kCalToday">Hari ini</button></div><div class="karsa-cal">${names.map(n=>`<div class="karsa-cal-day karsa-cal-head">${n}</div>`).join("")}`;
    for(let i=0;i<start;i++) html+=`<div class="karsa-cal-day"></div>`;
    for(let d=1;d<=total;d++){
      const iso=`${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
      const jobs=visibleJobs().filter(j=>j.deadline===iso).slice(0,4);
      const isToday=iso===today();
      html+=`<div class="karsa-cal-day"><div class="karsa-cal-num ${isToday?"today":""}">${d}</div>${jobs.map(j=>`<div class="karsa-cal-job ${j.status==="Selesai"?"done":""} ${j.status==="Terkendala"?"blocked":""}" data-open-ext-job="${esc(j.id)}"><b>${esc(j.assignee||"")}</b><br>${esc(j.title)}</div>`).join("")}</div>`;
    }
    html+=`</div>`;
    $("karsaExtBody").innerHTML=html;
    $("kCalPrev").onclick=()=>{window.__karsaCalendarDate=new Date(year,month-1,1);renderKarsaCalendar()};
    $("kCalNext").onclick=()=>{window.__karsaCalendarDate=new Date(year,month+1,1);renderKarsaCalendar()};
    $("kCalToday").onclick=()=>{window.__karsaCalendarDate=new Date();renderKarsaCalendar()};
    $("karsaExtBody").querySelectorAll("[data-open-ext-job]").forEach(b=>b.onclick=()=>{closeKarsaExtension();openJob(b.dataset.openExtJob)});
  }

  function renderKarsaAnalytics(){
    $("karsaExtEyebrow").textContent="EXECUTIVE INSIGHTS";
    $("karsaExtTitle").textContent="Analytics";
    const jobs=visibleJobs(), total=jobs.length;
    const done=jobs.filter(j=>j.status==="Selesai").length;
    const blocked=jobs.filter(j=>j.status==="Terkendala").length;
    const late=jobs.filter(j=>j.deadline&&j.deadline<today()&&j.status!=="Selesai").length;
    const avg=total?Math.round(jobs.reduce((a,j)=>a+j.progress,0)/total):0;
    const divisions=["Finance","IT","Operasional","R&D"];
    const status=["Belum Mulai","In Progress","Menunggu","Terkendala","Siap Review","Selesai"];
    $("karsaExtBody").innerHTML=`<div class="karsa-kpi-grid"><div class="karsa-kpi"><small>TOTAL JOB</small><strong>${total}</strong></div><div class="karsa-kpi"><small>AVG PROGRESS</small><strong>${avg}%</strong></div><div class="karsa-kpi"><small>SELESAI</small><strong>${done}</strong></div><div class="karsa-kpi"><small>TERKENDALA / LATE</small><strong>${blocked} / ${late}</strong></div></div><div class="karsa-analytics-grid"><div class="karsa-panel"><h3>Progress per Divisi</h3>${divisions.map(d=>{const a=jobs.filter(j=>j.division===d);const p=a.length?Math.round(a.reduce((x,j)=>x+j.progress,0)/a.length):0;return `<div class="karsa-bar-row"><div class="karsa-bar-label"><span>${d}</span><b>${a.length} job • ${p}%</b></div><div class="karsa-bar-track"><span style="width:${p}%"></span></div></div>`}).join("")}</div><div class="karsa-panel"><h3>Status Pekerjaan</h3>${status.map(s=>{const n=jobs.filter(j=>j.status===s).length;const p=total?Math.round(n/total*100):0;return `<div class="karsa-bar-row"><div class="karsa-bar-label"><span>${s}</span><b>${n}</b></div><div class="karsa-bar-track"><span style="width:${p}%"></span></div></div>`}).join("")}</div></div>`;
  }

  async function renderKarsaDirectory(){
    $("karsaExtEyebrow").textContent="KARSA PEOPLE";
    $("karsaExtTitle").textContent="People Directory";
    $("karsaExtBody").innerHTML=`<div class="karsa-ext-toolbar"><input id="kPeopleSearch" placeholder="Cari nama, divisi, jabatan..." /></div><div id="kPeopleGrid" class="karsa-people-grid"><div class="karsa-empty-mini">Memuat data...</div></div>`;
    if (!client) { renderPeople([]); return; }
    const {data,error}=await client.from("profiles").select("id,name,email,division,role,title,avatar_url,employee_id").order("name");
    if(error){renderPeople([]);showToast(error.message);return;}
    window.__karsaPeople=data||[];
    renderPeople(window.__karsaPeople);
    $("kPeopleSearch").oninput=e=>{const q=e.target.value.toLowerCase();renderPeople(window.__karsaPeople.filter(p=>`${p.name} ${p.division} ${p.title} ${p.email}`.toLowerCase().includes(q)))};
  }

  function renderPeople(people){
    const grid=$("kPeopleGrid"); if(!grid)return;
    grid.innerHTML=people.length?people.map(p=>{
      const id=karsaEmployeeId(p);
      const fallback=esc(initials(p.name));
      const avatar=p.avatar_url?`<img src="${esc(p.avatar_url)}" alt="" loading="lazy" onerror="this.remove();this.parentElement.insertAdjacentText("afterbegin","${fallback}")">`:fallback;
      return `<article class="karsa-person"><div class="karsa-person-avatar">${avatar}</div><div><strong>${esc(p.name||"—")}</strong><small>${esc(p.title||roleLabel(p.role)||"—")}</small><small>${esc(p.division||"—")}</small><small class="karsa-person-id">${esc(id)}</small></div></article>`;
    }).join(""):"<div class=\"karsa-empty-mini\">Tidak ada data.</div>";
  }

  async function loadJobExtras(job){
    if (!client || !$("modalBody")) return;
    const wrap=document.createElement("div");
    wrap.id="karsaJobExtras";wrap.className="karsa-job-extra";
    wrap.innerHTML=`<div class="karsa-extra-grid"><section class="karsa-extra-box"><h4>RIWAYAT PERUBAHAN</h4><div id="karsaTimeline" class="karsa-timeline"><div class="karsa-empty-mini">Memuat...</div></div></section><section class="karsa-extra-box"><h4>KOMENTAR</h4><div id="karsaComments" class="karsa-comment-list"><div class="karsa-empty-mini">Memuat...</div></div><div class="karsa-comment-form"><input id="karsaCommentInput" maxlength="1000" placeholder="Tulis komentar..."/><button id="karsaCommentSend" class="karsa-mini-btn gold">Kirim</button></div></section><section class="karsa-extra-box" style="grid-column:1/-1"><h4>FILE PEKERJAAN</h4><div id="karsaFiles" class="karsa-file-list"><div class="karsa-empty-mini">Memuat...</div></div><div style="margin-top:10px"><input id="karsaFileInput" type="file" /></div></section></div>`;
    $("modalBody").appendChild(wrap);
    await Promise.all([loadJobTimeline(job),loadJobComments(job),loadJobFiles(job)]);
    $("karsaCommentSend")?.addEventListener("click",()=>postJobComment(job));
    $("karsaCommentInput")?.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();postJobComment(job)}});
    $("karsaFileInput")?.addEventListener("change",e=>{const f=e.target.files?.[0];if(f)uploadJobFile(job,f);e.target.value=""});
  }

  async function loadJobTimeline(job){
    const box=$("karsaTimeline"); if(!box)return;
    const {data,error}=await client.from("progress_history").select("*").eq("job_id",job.id).order("created_at",{ascending:false}).limit(30);
    if(error){box.innerHTML=`<div class="karsa-empty-mini">Riwayat belum tersedia.</div>`;return;}
    const rows=data||[];
    box.innerHTML=rows.length?rows.map(x=>`<div class="karsa-timeline-item"><span class="karsa-timeline-dot"></span><div><strong>${esc(x.status||"Update")} • ${Number(x.progress||0)}%</strong><small>${esc(x.note||"Tidak ada catatan")} • ${x.created_at?new Date(x.created_at).toLocaleString("id-ID"):"—"}</small></div></div>`).join(""):"<div class=\"karsa-empty-mini\">Belum ada riwayat update.</div>";
  }

  async function loadJobComments(job){
    const box=$("karsaComments");if(!box)return;
    const {data,error}=await client.from("job_comments").select("id,body,user_id,created_at").eq("job_id",job.id).order("created_at",{ascending:false}).limit(50);
    if(error){box.innerHTML=`<div class="karsa-empty-mini">Komentar belum tersedia. Jalankan SQL fitur lanjutan.</div>`;return;}
    const rows=data||[];let names={};const ids=[...new Set(rows.map(x=>x.user_id).filter(Boolean))];if(ids.length){const r=await client.from("profiles").select("id,name").in("id",ids);(r.data||[]).forEach(p=>names[p.id]=p.name)}
    box.innerHTML=rows.length?rows.map(x=>`<div class="karsa-comment"><strong>${esc(names[x.user_id]||"KARSA User")}</strong><small> • ${x.created_at?new Date(x.created_at).toLocaleString("id-ID"):"—"}</small><p>${esc(x.body)}</p></div>`).join(""):"<div class=\"karsa-empty-mini\">Belum ada komentar.</div>";
  }

  async function postJobComment(job){
    const input=$("karsaCommentInput");const body=input?.value.trim();if(!body)return;
    const {error}=await client.from("job_comments").insert({job_id:job.id,user_id:state.user.id,body});
    if(error){showToast(error.message);return;} input.value="";await loadJobComments(job);showToast("Komentar ditambahkan.");
  }

  async function loadJobFiles(job){
    const box=$("karsaFiles");if(!box)return;
    const {data,error}=await client.from("job_attachments").select("id,file_name,file_path,file_size,mime_type,uploaded_by,created_at").eq("job_id",job.id).order("created_at",{ascending:false});
    if(error){box.innerHTML=`<div class="karsa-empty-mini">Attachment belum tersedia. Jalankan SQL fitur lanjutan.</div>`;return;}
    const rows=data||[];
    box.innerHTML=rows.length?rows.map(x=>`<div class="karsa-file"><div style="min-width:0"><div class="karsa-file-name">${esc(x.file_name)}</div><div class="karsa-file-meta">${Math.max(1,Math.round((x.file_size||0)/1024))} KB • ${x.created_at?new Date(x.created_at).toLocaleString("id-ID"):"—"}</div></div><button class="karsa-mini-btn" data-download-file="${esc(x.id)}">Buka</button></div>`).join(""):"<div class=\"karsa-empty-mini\">Belum ada file.</div>";
    box.querySelectorAll("[data-download-file]").forEach(b=>b.onclick=()=>downloadJobFile(b.dataset.downloadFile));
  }

  async function uploadJobFile(job,file){
    if(file.size>15*1024*1024){showToast("File maksimal 15 MB.");return;}
    const safe=file.name.replace(/[^a-zA-Z0-9._-]/g,"_");const path=`${job.id}/${crypto.randomUUID()}-${safe}`;
    const {error:up}=await client.storage.from("job-files").upload(path,file,{cacheControl:"3600",upsert:false,contentType:file.type||"application/octet-stream"});
    if(up){showToast(up.message);return;}
    const {error:db}=await client.from("job_attachments").insert({job_id:job.id,file_name:file.name,file_path:path,file_size:file.size,mime_type:file.type||"application/octet-stream",uploaded_by:state.user.id});
    if(db){await client.storage.from("job-files").remove([path]);showToast(db.message);return;}
    await loadJobFiles(job);showToast("File berhasil diunggah.");
  }

  async function downloadJobFile(id){
    const {data,error}=await client.from("job_attachments").select("file_name,file_path").eq("id",id).single();
    if(error||!data){showToast(error?.message||"File tidak ditemukan.");return;}
    const r=await client.storage.from("job-files").createSignedUrl(data.file_path,300);
    if(r.error){showToast(r.error.message);return;}
    window.open(r.data.signedUrl,"_blank","noopener");
  }

  function karsaVerifyModal(){
    if($("karsaVerifyModal"))return;
    const el=document.createElement("div");el.id="karsaVerifyModal";el.className="karsa-ext-overlay hidden";el.innerHTML=`<div class="karsa-ext-shell" style="max-width:560px"><div class="karsa-ext-head"><div><small>IDENTITY VERIFICATION</small><h2>KARSA ID Verification</h2></div><button class="karsa-ext-close" data-kv-close>×</button></div><div id="karsaVerifyBody" class="karsa-ext-body"></div></div>`;document.body.appendChild(el);el.addEventListener("click",e=>{if(e.target===el||e.target.closest("[data-kv-close]"))el.classList.add("hidden")});
  }

  async function handleKarsaVerifyQuery(){
    const id=new URLSearchParams(location.search).get("verify");if(!id)return;
    karsaVerifyModal();$("karsaVerifyModal").classList.remove("hidden");$("karsaVerifyBody").innerHTML=`<div class="karsa-empty-mini">Memverifikasi ${esc(id)}...</div>`;
    if(!client){$("karsaVerifyBody").innerHTML=`<div class="karsa-panel"><h3>Verification unavailable</h3><p>Sistem belum terhubung.</p></div>`;return;}
    const {data,error}=await client.rpc("verify_employee",{p_employee_id:id});
    if(error||!data){$("karsaVerifyBody").innerHTML=`<div class="karsa-panel"><h3>Identity not verified</h3><p>ID <b>${esc(id)}</b> tidak ditemukan atau tidak aktif.</p></div>`;return;}
    const p=Array.isArray(data)?data[0]:data;const photo=p.avatar_url?`url("${p.avatar_url}")`:"";$("karsaVerifyBody").innerHTML=`<div class="karsa-person" style="margin-bottom:12px"><div class="karsa-person-avatar" style="background-image:${photo}">${p.avatar_url?"":esc(initials(p.name))}</div><div><strong>${esc(p.name)}</strong><small>${esc(p.title||roleLabel(p.role))}</small><small>${esc(p.division)}</small><small class="karsa-person-id">${esc(p.employee_id)}</small></div></div><div class="karsa-panel"><h3>✓ Identity Verified</h3><p style="margin:0;color:#666;font-size:12px">Data identitas ditemukan pada sistem KARSA.</p></div>`;
  }

  function initKarsaExtensions(){
    karsaExtStyles();karsaAddNav();karsaMakeOverlay();
    handleKarsaVerifyQuery();
    const oldOpenJob=openJob;
    openJob=async function(jobId){ oldOpenJob(jobId); const j=state.jobs.find(x=>x.id===jobId); if(j) await loadJobExtras(j); };
    document.addEventListener("keydown",e=>{if(e.key==="Escape")closeKarsaExtension()});
  }

  /*
   * =========================================================
   * BOOT
   * =========================================================
   */

  async function boot() {

    karsaExtStyles();
    karsaAddNav();
    karsaMakeOverlay();
    bind();
    initKarsaExtensions();

    setInterval(
      tick,
      1000
    );

    tick();

    /*
     * Jangan tampilkan login sebelum status session selesai dicek.
     * Sebelumnya loginPage dijadwalkan muncul dengan setTimeout
     * tanpa memperhatikan auto-login. Akibatnya loginPage dapat
     * muncul kembali di atas aplikasi setelah enterApp().
     */
    $("loginPage").classList.add("hidden");
    $("app").classList.add("hidden");

    /*
     * =======================================================
     * SUPABASE SESSION
     * =======================================================
     */

    if (client) {

      const {
        data
      } =
        await client.auth.getSession();

      if (data.session) {

        const {
          data: p
        } =
          await client
            .from("profiles")
            .select("*")
            .eq("id", data.session.user.id)
            .single();

        if (p) {

          state.user = {
            id: data.session.user.id,
            name: p.name,
            email: p.email,
            role: p.role,
            division: p.division,
            initials: initials(p.name),
            title: p.title || roleLabel(p.role),
            employeeId: p.employee_id || "",
            avatarUrl: p.avatar_url || ""
          };

          await enterApp();
        }
      }

      /*
       * AUTH STATE
       */

      client.auth.onAuthStateChange(
        async (event, session) => {

          if (event === "SIGNED_OUT") {

            state.user = null;

            $("app").classList.add("hidden");
            $("loginPage").classList.remove("hidden");

            return;
          }

          if (session && !state.user) {

            const {
              data: p
            } =
              await client
                .from("profiles")
                .select("*")
                .eq("id", session.user.id)
                .single();

            if (p) {

              state.user = {
                id: session.user.id,
                name: p.name,
                email: p.email,
                role: p.role,
                division: p.division,
                initials: initials(p.name),
                title: p.title || roleLabel(p.role),
                avatarUrl: p.avatar_url || ""
              };

              await enterApp();
            }
          }
        }
      );
    }

    /*
     * Boot screen baru ditutup setelah session selesai dicek.
     * Jika auto-login berhasil, enterApp() sudah menampilkan app.
     * Jika tidak ada session, barulah loginPage ditampilkan.
     */
    $("bootStatus").textContent =
      "Opening secure workspace";

    await new Promise(resolve =>
      setTimeout(resolve, 650)
    );

    $("boot").classList.add("out");

    if (!state.user) {
      $("loginPage").classList.remove("hidden");

      if (CFG.DEMO_MODE) {
        $("demoBox").classList.remove("hidden");
      }
    }
  }

  /*
   * =========================================================
   * START
   * =========================================================
   */

  boot();

})();
