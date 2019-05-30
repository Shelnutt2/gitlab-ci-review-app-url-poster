/**
 * This is the main entrypoint to your Probot app
 * @param {import('probot').Application} app
 */
// import Gitlab from 'gitlab'
const Gitlab = require('gitlab/dist/es5').default

module.exports = app => {
  let getGitlabProject = async function (repositoryName) {
    // Find gitlab projects in the group
    let projects = await gitlabAPI.GroupProjects.all(process.env.GITLAB_GROUP_ID)
    let project = null
    // Search for repo with the same name
    for (let i = 0; i < projects.length; i++) {
      if (projects[i].name === repositoryName) {
        project = projects[i]
      }
    }
    return project
  }

  let getGitlabEnvironment = async function (project, branch) {
    let environment = null

    // If there exists a repo let's see if an environment exists for the branch
    if (project !== null) {
      let environments = await gitlabAPI.Environments.all(project.id)
      // Check if the environment which is review/$branch_name exists
      for (let i = 0; i < environments.length; i++) {
        if (environments[i].name === 'review/' + branch) {
          environment = environments[i]
        }
      }
    }
    return environment
  }

  // Instantiating gitlab
  const gitlabAPI = new Gitlab({
    url: process.env.GITLAB_URL, // Defaults to https://gitlab.com
    token: process.env.GITLAB_TOKEN // Can be created in your profile.
  })

  app.on(['pull_request.closed'], async context => {
    if (context.payload.pull_request.merged) {
      let project = await getGitlabProject(context.payload.repository.name)
      let environment = await getGitlabEnvironment(project, context.payload.pull_request.head.ref)
      await gitlabAPI.Environments.stop(project.id, environment.id)
      await gitlabAPI.Environments.remove(project.id, environment.id)
    }
  })

  app.on(['pull_request.opened', 'pull_request.edited', 'pull_request.synchronize', 'pull_request.reopened', 'check_run.completed', 'check_suite.completed'], async context => {
    let project = await getGitlabProject(context.payload.repository.name)
    let environment = await getGitlabEnvironment(project, context.payload.pull_request.head.ref)
    // If the environment exists mark it as deployed
    if (environment !== null && environment.external_url !== undefined && environment.external_url !== '') {
      // Probot API note: context.repo() => { username: 'hiimbex', repo: 'testing-things' }
      const res = await context.github.repos.createDeployment(context.repo({
        ref: context.payload.pull_request.head.ref, // The ref to deploy. This can be a branch, tag, or SHA.
        task: 'deploy', // Specifies a task to execute (e.g., deploy or deploy:migrations).
        auto_merge: false, // Attempts to automatically merge the default branch into the requested ref, if it is behind the default branch.
        required_contexts: [], // The status contexts to verify against commit status checks. If this parameter is omitted, then all unique contexts will be verified before a deployment is created. To bypass checking entirely pass an empty array. Defaults to all unique contexts.
        // payload: {
        //   'schema': 'rocks!'
        // }, // JSON payload with extra information about the deployment. Default: ""
        environment: 'review-app', // Name for the target deployment environment (e.g., production, staging, qa)
        description: 'Deployment of review app from gitlab ci', // Short description of the deployment
        transient_environment: true, // Specifies if the given environment is specific to the deployment and will no longer exist at some point in the future.
        production_environment: false // Specifies if the given environment is one that end-users directly interact with.
      }))

      const deploymentId = res.data.id
      await context.github.repos.createDeploymentStatus(context.repo({
        deployment_id: deploymentId,
        state: 'success', // The state of the status. Can be one of error, failure, inactive, pending, or success
        log_url: environment.external_url, // The log URL to associate with this status. This URL should contain output to keep the user updated while the task is running or serve as historical information for what happened in the deployment.
        description: 'Deployment successful for gitlab ci review app', // A short description of the status.
        environment_url: environment.external_url, // Sets the URL for accessing your environment.
        auto_inactive: true // Adds a new inactive status to all prior non-transient, non-production environment deployments with the same repository and environment name as the created status's deployment. An inactive status is only added to deployments that had a success state.
      }))
    }
  })
}
